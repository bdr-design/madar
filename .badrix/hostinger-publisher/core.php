<?php
declare(strict_types=1);

// Private publishing code. Only its sanitized snapshot is written to public_html.
const BX_RANK = ['reopened'=>-1, 'reverted'=>-1, 'planned'=>0, 'in_progress'=>1, 'testing'=>2, 'verified'=>3, 'released'=>4];
const BX_KINDS = ['build', 'fix', 'improvement', 'feature', 'milestone'];
const BX_SCOPES = ['documented', 'software', 'desktop', 'device', 'build', 'player'];

function bx_fail(string $message): never { throw new RuntimeException($message); }
function bx_id(mixed $value): bool {
    return is_string($value) && preg_match('/^[a-z0-9][a-z0-9._:-]{0,159}$/D', $value) === 1;
}
function bx_integer(mixed $value): bool {
    return (is_int($value) || is_float($value)) && is_finite((float)$value) && floor((float)$value) === (float)$value && abs((float)$value) <= 9007199254740991;
}
function bx_text(mixed $value): string {
    if (!is_string($value)) bx_fail('Invalid public development text');
    $length = preg_match_all('/./us', $value) + preg_match_all('/[\x{10000}-\x{10FFFF}]/u', $value);
    $trimmed = preg_replace('/^[\s\x{FEFF}]+|[\s\x{FEFF}]+$/u', '', $value);
    if ($trimmed === '' || $length > 700 || preg_match('~github|gitlab|repository|repositories|bdr-design|\.github|https?://|\bcommit\b|\bbranch\b|مستودع|مستودعات~iu', $value) || preg_match('/[<>\x00-\x08]/u', $value)) bx_fail('Invalid public development text');
    return $trimmed;
}
function bx_localized(mixed $value): array {
    if (!is_array($value)) bx_fail('Bilingual public text is required');
    return ['ar'=>bx_text($value['ar'] ?? null), 'en'=>bx_text($value['en'] ?? null)];
}
function bx_day(mixed $value): ?string {
    if ($value === null) return null;
    if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value) !== 1) bx_fail('Invalid development date');
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    if (!$date || $date->format('Y-m-d') !== $value) bx_fail('Invalid development date');
    return $value;
}
function bx_record_key(string $game, array $record): string {
    if ($record['kind'] === 'build' && !empty($record['artifact_sha256'])) {
        if (!is_string($record['artifact_sha256']) || preg_match('/^[a-f0-9]{64}$/D', $record['artifact_sha256']) !== 1) bx_fail('Invalid build fingerprint');
        return $game.':artifact:'.$record['artifact_sha256'];
    }
    $canonical = $record['canonical_id'] ?? $record['id'];
    if (!bx_id($canonical)) bx_fail('A stable game-scoped development id is required');
    return $game.':'.$record['kind'].':'.$canonical;
}
function bx_valid_record(array $record): void {
    if (!in_array($record['kind'] ?? null, BX_KINDS, true) || !array_key_exists($record['status'] ?? '', BX_RANK)) bx_fail('Invalid development event');
    if (!bx_id($record['id'] ?? null)) bx_fail('Invalid development event id');
    bx_localized($record['title'] ?? null); bx_localized($record['summary'] ?? null); bx_day($record['date'] ?? null);
    $revision = $record['revision'] ?? 0;
    if (!bx_integer($revision) || $revision < 0) bx_fail('Invalid event revision');
    if (isset($record['count']) && ($record['kind'] !== 'fix' || !bx_integer($record['count']) || $record['count'] < 1 || $record['count'] > 10000)) bx_fail('Only a documented review batch can carry a fix count');
    if (isset($record['verification']) && (!is_array($record['verification']) || !in_array($record['verification']['scope'] ?? null, BX_SCOPES, true))) bx_fail('Invalid verification scope');
    if (BX_RANK[$record['status']] >= 3 && (empty($record['verification']['scope']) || empty($record['verification']['evidence']))) bx_fail('Verified events require retained evidence');
    if (BX_RANK[$record['status']] >= 3 && $record['verification']['scope'] === 'documented') bx_fail('Documentation alone is not verified completion');
}
function bx_equivalent(array $a, array $b): bool {
    return [$a['kind'], $a['status'], $a['title'], $a['summary'], $a['date'] ?? null, $a['count'] ?? 1]
        === [$b['kind'], $b['status'], $b['title'], $b['summary'], $b['date'] ?? null, $b['count'] ?? 1];
}
function bx_merge_records(string $game, array $input): array {
    $records = [];
    foreach ($input as $record) {
        if (!is_array($record) || ($record['public'] ?? null) !== true) continue;
        bx_valid_record($record);
        $key = bx_record_key($game, $record);
        if (!isset($records[$key])) { $records[$key] = $record; continue; }
        $previous = $records[$key];
        $oldRevision = $previous['revision'] ?? 0; $nextRevision = $record['revision'] ?? 0;
        if ($nextRevision > $oldRevision) { $records[$key] = $record; continue; }
        if ($nextRevision < $oldRevision) continue;
        if (BX_RANK[$record['status']] > BX_RANK[$previous['status']]) { $records[$key] = $record; continue; }
        if (BX_RANK[$record['status']] < BX_RANK[$previous['status']] || bx_equivalent($previous, $record)) continue;
        if ($record['kind'] !== 'build') bx_fail('Conflicting duplicate event: '.$record['id']);
    }
    return array_values($records);
}
function bx_plan(mixed $plan, array $records): array {
    if (!$plan) return ['percent'=>null, 'milestones'=>[]];
    if (!is_array($plan) || !bx_id($plan['id'] ?? null) || empty($plan['milestones']) || !is_array($plan['milestones'])) bx_fail('Invalid target release plan');
    $completed = []; $seen = []; $milestones = []; $totalWeight = 0; $doneWeight = 0;
    foreach ($records as $record) if (BX_RANK[$record['status']] >= 3) $completed[$record['canonical_id'] ?? $record['id']] = true;
    foreach ($plan['milestones'] as $milestone) {
        $weight = $milestone['weight'] ?? null;
        if ((!is_int($weight) && !is_float($weight)) || !is_finite((float)$weight) || $weight <= 0 || empty($milestone['task_ids']) || !is_array($milestone['task_ids'])) bx_fail('Every release milestone needs positive weight and tasks');
        $done = 0;
        foreach ($milestone['task_ids'] as $id) {
            if (!bx_id($id) || isset($seen[$id])) bx_fail('A release task must have one owner');
            $seen[$id] = true; if (isset($completed[$id])) $done++;
        }
        $total = count($milestone['task_ids']);
        $totalWeight += $weight; $doneWeight += $weight * $done / $total;
        $milestones[] = ['title'=>bx_localized($milestone['title'] ?? null), 'percent'=>(int)round(100*$done/$total), 'completed_tasks'=>$done, 'total_tasks'=>$total];
    }
    if (abs($totalWeight - 100) > 0.000001) bx_fail('Release milestone weights must total 100');
    return ['percent'=>(int)round($doneWeight), 'milestones'=>$milestones];
}
function bx_snapshot(array $ledger, array $options = []): array {
    if (($ledger['schema_version'] ?? null) !== 1 || !isset($ledger['projects']) || !is_array($ledger['projects'])) bx_fail('Invalid ledger');
    $games = []; $identities = [];
    foreach ($ledger['projects'] as $project) {
        if (!bx_id($project['id'] ?? null) || isset($identities[$project['id']])) bx_fail('Invalid or duplicate stable game identity');
        $id = $project['id']; $identities[$id] = true;
        $records = bx_merge_records($id, $project['records'] ?? []);
        $complete = ($project['history_complete'] ?? false) === true;
        $metrics = [];
        foreach (['build', 'fix', 'improvement', 'feature'] as $kind) {
            $count = 0;
            foreach ($records as $record) if ($record['kind'] === $kind && BX_RANK[$record['status']] >= 3) $count += (int)($record['count'] ?? 1);
            $metrics[$kind] = ['value'=>($complete || $count) ? $count : null, 'is_minimum'=>!$complete && $count > 0];
        }
        $total = ($metrics['fix']['value'] ?? 0) + ($metrics['improvement']['value'] ?? 0) + ($metrics['feature']['value'] ?? 0);
        $release = $project['first_playable_release'] ?? [];
        $releaseStatus = in_array($release['status'] ?? null, ['unannounced', 'date_pending', 'scheduled', 'released'], true) ? $release['status'] : 'unannounced';
        $releaseDate = bx_day($release['date'] ?? null);
        if (in_array($releaseStatus, ['scheduled', 'released'], true) && !$releaseDate) bx_fail('An announced release requires an approved date');
        $publicRecords = [];
        foreach ($records as $record) $publicRecords[] = [
            'id'=>substr(hash('sha256', bx_record_key($id, $record)), 0, 20),
            'kind'=>$record['kind'], 'status'=>$record['status'], 'count'=>(int)($record['count'] ?? 1),
            'title'=>bx_localized($record['title']), 'summary'=>bx_localized($record['summary']), 'date'=>bx_day($record['date'] ?? null),
            'verification_scope'=>$record['verification']['scope'] ?? 'documented'
        ];
        usort($publicRecords, static fn(array $a, array $b): int => strcmp($b['date'] ?? '', $a['date'] ?? '') ?: strcmp($a['id'], $b['id']));
        $games[] = [
            'id'=>$id, 'title'=>bx_localized($project['title'] ?? null), 'stage'=>bx_localized($project['stage'] ?? null),
            'started_on'=>bx_day($project['started_on'] ?? null), 'first_playable_release'=>['status'=>$releaseStatus, 'date'=>$releaseDate],
            'coverage'=>$complete ? 'complete' : 'partial', 'readiness'=>bx_plan($project['plan'] ?? null, $records), 'metrics'=>$metrics,
            'total_development'=>['value'=>($complete || $total) ? $total : null, 'is_minimum'=>!$complete && $total > 0],
            'records'=>$publicRecords
        ];
    }
    return ['schema_version'=>1, 'updated_at'=>$options['updatedAt'] ?? gmdate('Y-m-d\TH:i:s.000\Z'), 'sync'=>['mode'=>$options['mode'] ?? 'prepared', 'complete'=>($options['complete'] ?? false) === true], 'games'=>$games];
}

function bx_selftest(string $path): int {
    $fixtures = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    $count = 0;
    foreach ($fixtures as $fixture) {
        $failed = false; $actual = null;
        try { $actual = bx_snapshot($fixture['ledger'], $fixture['options']); }
        catch (Throwable $error) { $failed = true; }
        if (isset($fixture['error'])) {
            if (!$failed) bx_fail('Publisher self-check failed: '.$fixture['name']);
        } elseif ($failed || $actual !== $fixture['expected']) bx_fail('Publisher self-check failed: '.$fixture['name']);
        $count++;
    }
    return $count;
}
