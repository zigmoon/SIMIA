<?php
/**
 * SIMIA Agent API — recherche web sécurisée + lecture de pages publiques.
 * Un service minimal de type OpenCrawl, appelé uniquement quand l'utilisateur
 * active le mode Agent. Aucune donnée n'est conservée.
 *
 * Modes :
 *   ?action=search&q=...   -> recherche publique (DuckDuckGo instant answer + HTML)
 *   ?action=fetch&url=...  -> lecture d'une page publique (HTML -> texte)
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

const MAX_FETCH_BYTES = 512000;
const MAX_TEXT_LENGTH = 6000;
const MAX_REDIRECTS = 3;

function respond(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function isPublicIp(string $ip): bool {
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}

function validatePublicUrl(string $value): string {
    $url = filter_var($value, FILTER_VALIDATE_URL);
    if ($url === false) respond(400, ['success' => false, 'error' => 'Invalid URL']);
    $parts = parse_url($url);
    if (!isset($parts['scheme'], $parts['host']) || !in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
        respond(400, ['success' => false, 'error' => 'Only public HTTP URLs are allowed']);
    }
    if (isset($parts['user']) || isset($parts['pass']) || (isset($parts['port']) && !in_array((int) $parts['port'], [80, 443], true))) {
        respond(400, ['success' => false, 'error' => 'URL credentials and custom ports are not allowed']);
    }
    $host = strtolower(rtrim($parts['host'], '.'));
    if ($host === 'localhost' || str_ends_with($host, '.local')) {
        respond(403, ['success' => false, 'error' => 'Private hosts are not allowed']);
    }
    $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : gethostbynamel($host);
    if (!$ips) respond(502, ['success' => false, 'error' => 'Host could not be resolved']);
    foreach ($ips as $ip) {
        if (!isPublicIp($ip)) respond(403, ['success' => false, 'error' => 'Private network addresses are not allowed']);
    }
    return $url;
}

function httpGet(string $url, array $headers = []): array {
    $context = stream_context_create(['http' => [
        'timeout' => 10,
        'user_agent' => 'SIMIA Agent/1.0 (local-first assistant)',
        'follow_location' => 0,
        'ignore_errors' => true,
        'header' => implode("\r\n", $headers)
    ]]);
    $stream = @fopen($url, 'rb', false, $context);
    if ($stream === false) return [502, '', []];
    $metadata = stream_get_meta_data($stream);
    $body = stream_get_contents($stream, MAX_FETCH_BYTES + 1);
    fclose($stream);
    $status = 0;
    $rawHeaders = $metadata['wrapper_data'] ?? [];
    foreach ($rawHeaders as $line) {
        if (preg_match('~^HTTP/\S+\s+(\d{3})~i', $line, $m)) $status = (int) $m[1];
    }
    return [$status, $body, $rawHeaders];
}

function absoluteUrl(string $base, string $location): string {
    if (filter_var($location, FILTER_VALIDATE_URL)) return $location;
    $parts = parse_url($base);
    if (str_starts_with($location, '//')) return $parts['scheme'] . ':' . $location;
    if (str_starts_with($location, '/')) return $parts['scheme'] . '://' . $parts['host'] . $location;
    $path = $parts['path'] ?? '/';
    return $parts['scheme'] . '://' . $parts['host'] . preg_replace('~/[^/]*$~', '/', $path) . $location;
}

function htmlToText(string $html): string {
    // Retire scripts/styles/nav/header/footer puis extrait le texte.
    $html = preg_replace('~<(script|style|noscript|header|nav|footer|aside|form)[^>]*>.*?</\1>~is', ' ', $html);
    $html = preg_replace('~<!--.*?-->~s', ' ', $html);
    $html = preg_replace('~<br\s*/?>~i', "\n", $html);
    $html = preg_replace('~</(p|div|li|h[1-6]|tr|section|article)>~i', "\n", $html);
    $text = trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    $text = preg_replace('/[ \t]+/u', ' ', $text);
    $text = preg_replace('/\n{3,}/u', "\n\n", $text);
    return trim($text);
}

function extractLinks(string $html, string $base): array {
    preg_match_all('~<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>~is', $html, $matches, PREG_SET_ORDER);
    $links = [];
    foreach ($matches as $m) {
        $href = absoluteUrl($base, trim($m[1]));
        $label = trim(html_entity_decode(strip_tags($m[2]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if (str_starts_with($href, 'http') && $label !== '') {
            $links[] = ['title' => mb_substr($label, 0, 120), 'url' => $href];
        }
    }
    return $links;
}

$action = $_GET['action'] ?? 'search';

if ($action === 'search') {
    $query = trim($_GET['q'] ?? '');
    if ($query === '') respond(400, ['success' => false, 'error' => 'Missing query']);
    if (mb_strlen($query) > 300) $query = mb_substr($query, 0, 300);

    $results = [];

    // 1) DuckDuckGo Instant Answer (json)
    $ddg = httpGet('https://api.duckduckgo.com/?q=' . rawurlencode($query) . '&format=json&no_html=1&skip_disambig=1', []);
    if ($ddg[0] === 200) {
        $json = json_decode($ddg[1], true);
        if (is_array($json)) {
            if (!empty($json['AbstractText'])) {
                $results[] = ['title' => $json['Heading'] ?? $query, 'text' => $json['AbstractText'], 'url' => $json['AbstractURL'] ?? ''];
            }
            if (!empty($json['Answer'])) {
                $results[] = ['title' => $query, 'text' => $json['Answer'], 'url' => ''];
            }
        }
    }

    // 2) DuckDuckGo HTML (parse les liens de résultats)
    $html = httpGet('https://html.duckduckgo.com/html/?q=' . rawurlencode($query), [
        'Accept: text/html',
    ]);
    if ($html[0] === 200) {
        foreach (extractLinks($html[1], 'https://html.duckduckgo.com/html/') as $link) {
            // Les liens de résultats pointent vers des URLs de redirection duckduckgo ; on les filtre.
            $u = $link['url'];
            if (str_contains($u, 'duckduckgo.com')) {
                parse_str(parse_url($u, PHP_URL_QUERY) ?? '', $p);
                if (!empty($p['uddg'])) $u = urldecode($p['uddg']);
            }
            if (!str_starts_with($u, 'http')) continue;
            $host = parse_url($u, PHP_URL_HOST) ?: '';
            if ($host === '' || str_contains($host, 'duckduckgo.com')) continue;
            $results[] = ['title' => $link['title'], 'text' => '', 'url' => $u];
            if (count($results) >= 8) break;
        }
    }

    // Déduplique par URL.
    $seen = [];
    $unique = [];
    foreach ($results as $r) {
        $key = $r['url'] !== '' ? $r['url'] : $r['text'];
        if (isset($seen[$key])) continue;
        $seen[$key] = true;
        $unique[] = $r;
    }

    if (empty($unique)) {
        respond(200, ['success' => true, 'results' => [], 'message' => 'No public result found']);
    }
    respond(200, ['success' => true, 'results' => array_slice($unique, 0, 8)]);
}

if ($action === 'fetch') {
    $url = validatePublicUrl($_GET['url'] ?? '');
    $redirects = 0;
    $finalUrl = $url;

    while ($redirects <= MAX_REDIRECTS) {
        $res = httpGet($finalUrl, ['Accept: text/html, text/plain, application/xhtml+xml']);
        $status = $res[0];
        $body = $res[1];
        $headers = $res[2];

        if ($status >= 300 && $status < 400) {
            $location = '';
            foreach ($headers as $line) {
                if (stripos($line, 'Location:') === 0) { $location = trim(substr($line, 9)); break; }
            }
            if ($location === '') respond(502, ['success' => false, 'error' => 'Redirect without location']);
            $finalUrl = validatePublicUrl(absoluteUrl($finalUrl, $location));
            $redirects += 1;
            continue;
        }
        if ($status < 200 || $status >= 300) respond(502, ['success' => false, 'error' => "Page returned HTTP $status"]);
        if (strlen($body) > MAX_FETCH_BYTES) respond(413, ['success' => false, 'error' => 'Page too large']);
        break;
    }

    $text = htmlToText($body);
    if ($text === '') respond(502, ['success' => false, 'error' => 'No readable text']);
    respond(200, [
        'success' => true,
        'url' => $finalUrl,
        'title' => '',
        'text' => mb_substr($text, 0, MAX_TEXT_LENGTH),
        'links' => array_slice(extractLinks($body, $finalUrl), 0, 6)
    ]);
}

respond(400, ['success' => false, 'error' => 'Unknown action']);
