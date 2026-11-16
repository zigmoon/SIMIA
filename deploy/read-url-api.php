<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

const MAX_RESPONSE_BYTES = 1048576;
const MAX_TEXT_LENGTH = 12000;
const MAX_REDIRECTS = 3;

function fail(int $status, string $message): void {
    http_response_code($status);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

function isPublicIp(string $ip): bool {
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}

function validatePublicUrl(string $value): string {
    $url = filter_var($value, FILTER_VALIDATE_URL);
    if ($url === false) fail(400, 'Invalid URL');
    $parts = parse_url($url);
    if (!isset($parts['scheme'], $parts['host']) || !in_array(strtolower($parts['scheme']), ['http', 'https'], true)) fail(400, 'Only public HTTP URLs are allowed');
    if (isset($parts['user']) || isset($parts['pass']) || (isset($parts['port']) && !in_array((int) $parts['port'], [80, 443], true))) fail(400, 'URL credentials and custom ports are not allowed');
    $host = strtolower(rtrim($parts['host'], '.'));
    if ($host === 'localhost' || str_ends_with($host, '.local')) fail(403, 'Private hosts are not allowed');
    $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : gethostbynamel($host);
    if (!$ips) fail(502, 'Host could not be resolved');
    foreach ($ips as $ip) {
        if (!isPublicIp($ip)) fail(403, 'Private network addresses are not allowed');
    }
    return $url;
}

function absoluteUrl(string $base, string $location): string {
    if (filter_var($location, FILTER_VALIDATE_URL)) return $location;
    $parts = parse_url($base);
    if (str_starts_with($location, '//')) return $parts['scheme'] . ':' . $location;
    if (str_starts_with($location, '/')) return $parts['scheme'] . '://' . $parts['host'] . $location;
    $path = $parts['path'] ?? '/';
    return $parts['scheme'] . '://' . $parts['host'] . preg_replace('~/[^/]*$~', '/', $path) . $location;
}

function fetchPage(string $url, int $redirects = 0): array {
    $url = validatePublicUrl($url);
    $context = stream_context_create(['http' => [
        'timeout' => 8,
        'user_agent' => 'SIMIA Page Reader/1.0',
        'follow_location' => 0,
        'ignore_errors' => true,
        'header' => "Accept: text/html, text/plain, application/xhtml+xml\r\n"
    ]]);
    $stream = @fopen($url, 'rb', false, $context);
    if ($stream === false) fail(502, 'Page unavailable');
    $metadata = stream_get_meta_data($stream);
    $body = stream_get_contents($stream, MAX_RESPONSE_BYTES + 1);
    fclose($stream);
    $headers = $metadata['wrapper_data'] ?? [];
    $status = 0;
    $contentType = '';
    $location = '';
    foreach ($headers as $header) {
        if (preg_match('~^HTTP/\S+\s+(\d{3})~i', $header, $match)) $status = (int) $match[1];
        if (stripos($header, 'Content-Type:') === 0) $contentType = trim(substr($header, 13));
        if (stripos($header, 'Location:') === 0) $location = trim(substr($header, 9));
    }
    if ($status >= 300 && $status < 400 && $location !== '') {
        if ($redirects >= MAX_REDIRECTS) fail(502, 'Too many redirects');
        return fetchPage(absoluteUrl($url, $location), $redirects + 1);
    }
    if ($status < 200 || $status >= 300) fail(502, 'Page returned an error');
    if (strlen($body) > MAX_RESPONSE_BYTES) fail(413, 'Page is too large');
    if (!preg_match('~^(text/html|text/plain|application/xhtml\+xml)~i', $contentType)) fail(415, 'Unsupported page type');
    return [$url, $body, $contentType];
}

function extractPageText(string $html, string $contentType): array {
    if (stripos($contentType, 'text/plain') === 0) {
        $text = preg_replace('/\s+/u', ' ', $html);
        return ['', trim(mb_substr($text, 0, MAX_TEXT_LENGTH))];
    }
    libxml_use_internal_errors(true);
    $document = new DOMDocument();
    $document->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET);
    $title = trim($document->getElementsByTagName('title')->item(0)?->textContent ?? '');
    $xpath = new DOMXPath($document);
    foreach ($xpath->query('//script|//style|//noscript|//svg|//nav|//footer|//form') as $node) $node->parentNode?->removeChild($node);
    $main = $xpath->query('//main|//article')->item(0) ?? $document->getElementsByTagName('body')->item(0);
    $text = html_entity_decode($main?->textContent ?? '', ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = trim(preg_replace('/\s+/u', ' ', $text));
    return [mb_substr($title, 0, 300), mb_substr($text, 0, MAX_TEXT_LENGTH)];
}

$url = trim($_GET['url'] ?? '');
if ($url === '') fail(400, 'Missing URL');
[$finalUrl, $body, $contentType] = fetchPage($url);
[$title, $text] = extractPageText($body, $contentType);
if ($text === '') fail(422, 'No readable content found');

echo json_encode(['success' => true, 'url' => $finalUrl, 'title' => $title, 'text' => $text], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
