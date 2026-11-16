<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$query = trim($_GET['q'] ?? '');
if ($query === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing query']);
    exit;
}

$language = $_GET['lang'] ?? 'fr';
$mode = $_GET['mode'] ?? 'web';
$locale = ['fr' => ['fr-FR', 'FR', 'fr'], 'es' => ['es-ES', 'ES', 'es'], 'en' => ['en-US', 'US', 'en']][$language] ?? ['fr-FR', 'FR', 'fr'];
$endpoint = $mode === 'news'
    ? 'https://news.google.com/rss/search?' . http_build_query([
        'q' => $query,
        'hl' => $locale[0],
        'gl' => $locale[1],
        'ceid' => $locale[1] . ':' . $locale[2]
    ])
    : 'https://www.bing.com/search?' . http_build_query([
        'q' => $query,
        'format' => 'rss',
        'setlang' => $locale[0],
        'cc' => $locale[1]
    ]);
$context = stream_context_create(['http' => [
    'timeout' => 8,
    'user_agent' => 'SIMIA Web Search/1.0'
]]);
$response = @file_get_contents($endpoint, false, $context);
if ($response === false) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Bing unavailable']);
    exit;
}

libxml_use_internal_errors(true);
$feed = simplexml_load_string($response);
if ($feed === false || !isset($feed->channel->item)) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Invalid Bing response']);
    exit;
}

$results = [];
foreach ($feed->channel->item as $item) {
    $url = (string) $item->link;
    if (!filter_var($url, FILTER_VALIDATE_URL)) continue;
    $text = trim(html_entity_decode(strip_tags((string) $item->description), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    if ($text === '') continue;
    $result = ['title' => trim((string) $item->title), 'text' => $text, 'url' => $url];
    if ($mode === 'news') {
        $publishedAt = strtotime((string) $item->pubDate);
        $result['source'] = trim((string) $item->source);
        if ($publishedAt !== false) $result['publishedAt'] = gmdate(DATE_ATOM, $publishedAt);
    }
    $results[] = $result;
    if (count($results) === ($mode === 'news' ? 3 : 5)) break;
}

echo json_encode(['success' => true, 'results' => $results]);