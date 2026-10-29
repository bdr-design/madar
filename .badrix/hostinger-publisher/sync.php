<?php
declare(strict_types=1);

// This entry point is scheduled by Hostinger Cron and stays outside public_html.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/core.php';
ini_set('display_errors', '0');
error_reporting(E_ALL);
set_time_limit(240);

function bx_json_file(string $path): array {
    $data = file_get_contents($path);
    if ($data === false) bx_fail('Cannot read publisher configuration');
    $result = json_decode($data, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($result)) bx_fail('Invalid publisher configuration');
    return $result;
}
function bx_atomic_json(string $path, array $value, bool $public = false): void {
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, $public ? 0755 : 0700, true) && !is_dir($directory)) bx_fail('Cannot create publisher directory');
    $temp = tempnam($directory, '.badrix-');
    if ($temp === false) bx_fail('Cannot prepare publisher output');
    try {
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n";
        if (file_put_contents($temp, $json, LOCK_EX) === false) bx_fail('Cannot write publisher output');
        chmod($temp, $public ? 0644 : 0600);
        if (!rename($temp, $path)) bx_fail('Cannot replace publisher output');
    } finally { if (is_file($temp)) unlink($temp); }
}
function bx_handle(string $url): CurlHandle {
    $handle = curl_init($url);
    if ($handle === false) bx_fail('Cannot initialize source request');
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER=>true, CURLOPT_FOLLOWLOCATION=>true, CURLOPT_MAXREDIRS=>3,
        CURLOPT_CONNECTTIMEOUT=>6, CURLOPT_TIMEOUT=>20, CURLOPT_SSL_VERIFYPEER=>true, CURLOPT_SSL_VERIFYHOST=>2,
        CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_USERAGENT=>'BADRIX-development-publisher', CURLOPT_HTTPHEADER=>['Accept: application/vnd.github+json'],
        CURLOPT_WRITEFUNCTION=>static function (CurlHandle $curl, string $chunk): int {
            $key = spl_object_id($curl);
            $size = ($GLOBALS['bx_response_sizes'][$key] ?? 0) + strlen($chunk);
            $GLOBALS['bx_response_sizes'][$key] = $size;
            if ($size > 1500000) return 0;
            $GLOBALS['bx_response_bodies'][$key] = ($GLOBALS['bx_response_bodies'][$key] ?? '').$chunk;
            return strlen($chunk);
        }
    ]);
    return $handle;
}
function bx_result(CurlHandle $handle, string $kind, bool $missingOkay = false): ?array {
    $key = spl_object_id($handle);
    $body = $GLOBALS['bx_response_bodies'][$key] ?? '';
    unset($GLOBALS['bx_response_bodies'][$key], $GLOBALS['bx_response_sizes'][$key]);
    $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_errno($handle);
    if ($error !== 0) bx_fail('Source request did not complete ('.$kind.')');
    if ($status === 404 && $missingOkay) return null;
    if ($status !== 200) bx_fail('Source request failed: HTTP '.$status.' ('.$kind.')');
    $result = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($result)) bx_fail('Invalid source response');
    return $result;
}
function bx_api(string $route): array {
    $handle = bx_handle('https://api.github.com/'.$route);
    try { curl_exec($handle); return bx_result($handle, 'branch listing'); }
    finally { curl_close($handle); }
}
function bx_raw_batch(array $pending): array {
    $multi = curl_multi_init(); $handles = []; $result = [];
    try {
        foreach ($pending as $item) {
            $handle = bx_handle($item['url']);
            $handles[] = ['handle'=>$handle, 'item'=>$item];
            curl_multi_add_handle($multi, $handle);
        }
        do {
            do { $status = curl_multi_exec($multi, $running); } while ($status === CURLM_CALL_MULTI_PERFORM);
            if ($status !== CURLM_OK) bx_fail('Source batch did not complete');
            if ($running) { if (curl_multi_select($multi, 0.5) === -1) usleep(10000); }
        } while ($running);
        foreach ($handles as $entry) {
            $item = $entry['item'];
            $journal = bx_result($entry['handle'], 'public journal', true);
            if ($journal !== null && (($journal['schema_version'] ?? null) !== 1 || ($journal['game_id'] ?? null) !== $item['game_id'] || !isset($journal['records']) || !is_array($journal['records']))) bx_fail('Invalid game-scoped source journal');
            $result[$item['key']] = $journal === null ? null : $journal['records'];
        }
        return $result;
    } finally {
        foreach ($handles as $entry) {
            $key = spl_object_id($entry['handle']);
            unset($GLOBALS['bx_response_bodies'][$key], $GLOBALS['bx_response_sizes'][$key]);
            curl_multi_remove_handle($multi, $entry['handle']); curl_close($entry['handle']);
        }
        curl_multi_close($multi);
    }
}
function bx_collect(array &$ledger, array $registry, array $state): array {
    if (($registry['schema_version'] ?? null) !== 1 || ($registry['all_branches'] ?? null) !== true || !is_array($registry['projects'] ?? null)) bx_fail('All-branch registry is required');
    $projects = [];
    foreach ($ledger['projects'] as $index=>$project) {
        $projects[$project['id']] = $index;
        $ledger['projects'][$index]['records'] = array_merge($project['records'] ?? [], $state['projects'][$project['id']] ?? []);
    }
    $pending = []; $cache = []; $seen = []; $sources = []; $totalHeads = 0;
    foreach ($registry['projects'] as $entry) {
        $game = $entry['game_id'];
        if (!array_key_exists($game, $projects)) bx_fail('Unknown source game identity');
        foreach ($entry['sources'] as $source) {
            $repo = $source['repository'] ?? ''; $path = $source['ledger_path'] ?? '';
            if (!is_string($repo) || preg_match('~^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$~D', $repo) !== 1 || !is_string($path) || preg_match('~^[A-Za-z0-9_./-]+$~D', $path) !== 1 || in_array('..', explode('/', $path), true)) bx_fail('Invalid source identity');
            $report = ['game_id'=>$game, 'repository'=>$repo, 'branches'=>0, 'journals'=>0];
            for ($page=1; $page<=100; $page++) {
                $branches = bx_api('repos/'.$repo.'/branches?per_page=100&page='.$page);
                if (!array_is_list($branches)) bx_fail('Invalid branch response');
                foreach ($branches as $branch) {
                    $sha = $branch['commit']['sha'] ?? '';
                    if (!is_string($branch['name'] ?? null) || !is_string($sha) || preg_match('/^[a-f0-9]{40}$/D', $sha) !== 1) bx_fail('Invalid immutable source head');
                    if (++$totalHeads > 3000) bx_fail('Source head budget reached');
                    $report['branches']++;
                    $key = $repo.':'.$sha.':'.$path;
                    if (isset($seen[$key])) continue;
                    $seen[$key] = true;
                    if (array_key_exists($key, $state['cache'] ?? [])) $cache[$key] = $state['cache'][$key];
                    else $pending[] = ['key'=>$key, 'game_id'=>$game, 'url'=>'https://raw.githubusercontent.com/'.$repo.'/'.$sha.'/'.$path];
                }
                if (count($branches) < 100) break;
                if ($page === 100) bx_fail('Source pagination budget reached');
            }
            $sources[] = $report;
        }
    }
    foreach (array_chunk($pending, 12) as $batch) $cache = array_replace($cache, bx_raw_batch($batch));
    foreach ($registry['projects'] as $entry) foreach ($entry['sources'] as $source) {
        $prefix = $source['repository'].':'; $suffix = ':'.$source['ledger_path'];
        foreach ($cache as $key=>$records) {
            if (!str_starts_with($key, $prefix) || !str_ends_with($key, $suffix) || $records === null) continue;
            if (!is_array($records)) bx_fail('Invalid source cache');
            $index = $projects[$entry['game_id']];
            $ledger['projects'][$index]['records'] = array_merge($ledger['projects'][$index]['records'], $records);
        }
    }
    foreach ($sources as &$report) {
        foreach ($cache as $key=>$records) if ($records !== null && str_starts_with($key, $report['repository'].':')) $report['journals']++;
    }
    unset($report);
    $retained = [];
    foreach ($ledger['projects'] as $project) $retained[$project['id']] = bx_merge_records($project['id'], $project['records']);
    return ['state'=>['cache'=>$cache, 'projects'=>$retained], 'sources'=>$sources, 'branches'=>$totalHeads, 'new_heads'=>count($pending)];
}

$stateDirectory = __DIR__.'/state';
if (!is_dir($stateDirectory) && !mkdir($stateDirectory, 0700, true) && !is_dir($stateDirectory)) bx_fail('Cannot initialize private publisher state');
$lock = fopen($stateDirectory.'/sync.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { echo "Publisher is already running.\n"; exit(0); }
try {
    $tests = bx_selftest(__DIR__.'/fixtures.json');
    if (!extension_loaded('curl')) bx_fail('PHP cURL is required');
    $config = bx_json_file(__DIR__.'/config.json');
    $outputRelative = $config['output'] ?? '';
    if ($outputRelative !== '../public_html/data/development.json') bx_fail('Unexpected public output location');
    $output = __DIR__.'/'.$outputRelative;
    $ledger = bx_json_file(__DIR__.'/curated-ledger.json');
    $registry = bx_json_file(__DIR__.'/sources.json');
    $statePath = $stateDirectory.'/history-state.json';
    $state = is_file($statePath) ? bx_json_file($statePath) : ['cache'=>[], 'projects'=>[]];
    if (!is_array($state['cache'] ?? null) || !is_array($state['projects'] ?? null)) bx_fail('Invalid retained publisher state');
    $collected = bx_collect($ledger, $registry, $state);
    $snapshot = bx_snapshot($ledger, ['mode'=>'automatic', 'complete'=>true]);
    bx_atomic_json($statePath, $collected['state']);
    bx_atomic_json($output, $snapshot, true);
    $status = ['ok'=>true, 'updated_at'=>$snapshot['updated_at'], 'tests'=>$tests, 'games'=>count($snapshot['games']), 'branches'=>$collected['branches'], 'new_heads'=>$collected['new_heads'], 'sources'=>$collected['sources']];
    bx_atomic_json($stateDirectory.'/status.json', $status);
    echo json_encode(['ok'=>true, 'updated_at'=>$status['updated_at'], 'games'=>$status['games'], 'branches'=>$status['branches'], 'self_checks'=>$tests], JSON_UNESCAPED_SLASHES)."\n";
} catch (Throwable $error) {
    $status = ['ok'=>false, 'checked_at'=>gmdate('c'), 'error'=>$error->getMessage()];
    try { bx_atomic_json($stateDirectory.'/status.json', $status); } catch (Throwable $ignored) {}
    fwrite(STDERR, 'BADRIX synchronization stopped: '.$error->getMessage()."\n");
    exit(1);
} finally { flock($lock, LOCK_UN); fclose($lock); }
