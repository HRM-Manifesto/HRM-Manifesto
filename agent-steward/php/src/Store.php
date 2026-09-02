<?php
declare(strict_types=1);

namespace Hrm\Steward;

use PDO;
use PDOException;
use RuntimeException;

interface StewardStore
{
    public function createTask(array $task, int $expiresAt): void;
    public function getTask(string $taskId, int $now): ?array;
    public function listTasks(?string $contextId, int $limit, int $now): array;
    public function createSubmission(array $submission): void;
    public function moderateSubmission(string $id, string $decision, int $now): bool;
    public function publishedBoard(int $limit): array;
    public function rateLimit(string $bucket, string $subjectHash, int $windowStart, int $limit): bool;
    public function createKnowledgeCapsule(array $capsule, int $createdAt, string $submissionMethod = 'a2a', ?string $continuationTokenHash = null): void;
    public function getKnowledgeCapsule(string $capsuleId): ?array;
    public function recordKnowledgeCapsuleEvent(string $capsuleId, string $eventKind, ?string $relatedCapsuleId, int $createdAt): void;
    public function knowledgeCapsuleLineage(string $capsuleId): ?array;
}

final class PdoStewardStore implements StewardStore
{
    public function __construct(private readonly PDO $pdo)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
    }

    public static function connect(array $database): self
    {
        foreach (['host', 'name', 'user', 'password'] as $key) {
            if (!isset($database[$key]) || !is_string($database[$key]) || $database[$key] === '') {
                throw new RuntimeException('Invalid database configuration');
            }
        }
        $port = (int) ($database['port'] ?? 3306);
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $database['host'], $port, $database['name']);
        $store = new self(new PDO($dsn, $database['user'], $database['password'], [
            PDO::ATTR_TIMEOUT => 10,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]));
        $store->ensureSchema();
        return $store;
    }

    public function ensureSchema(): void
    {
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS hrm_a2a_tasks (
            id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            context_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            task_json MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            status VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            created_at DATETIME(3) NOT NULL,
            expires_at DATETIME(3) NOT NULL,
            PRIMARY KEY (id), KEY ix_hrm_tasks_context (context_id, created_at), KEY ix_hrm_tasks_expiry (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS hrm_board_entries (
            id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            declared_identity VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
            verification_status VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'unverified',
            entry_kind VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            content TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
            source_url VARCHAR(1000) CHARACTER SET ascii COLLATE ascii_bin NULL,
            status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
            created_at DATETIME(3) NOT NULL,
            published_at DATETIME(3) NULL,
            hrm_reply TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
            hrm_references_json TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
            PRIMARY KEY (id), KEY ix_hrm_board_public (status, published_at), KEY ix_hrm_board_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS hrm_rate_limits (
            bucket VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            subject_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            window_start BIGINT NOT NULL,
            hits INT NOT NULL,
            PRIMARY KEY (bucket, subject_hash, window_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin");
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS hrm_knowledge_capsules (
            capsule_id CHAR(39) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            previous_capsule_id CHAR(39) CHARACTER SET ascii COLLATE ascii_bin NULL,
            protocol_version VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            capsule_json MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            created_at DATETIME(3) NOT NULL,
            PRIMARY KEY (capsule_id), KEY ix_hrm_capsule_previous (previous_capsule_id), KEY ix_hrm_capsule_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS hrm_knowledge_capsule_events (
            id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            capsule_id CHAR(39) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            event_kind VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            related_capsule_id CHAR(39) CHARACTER SET ascii COLLATE ascii_bin NULL,
            created_at DATETIME(3) NOT NULL,
            PRIMARY KEY (id), KEY ix_hrm_capsule_event (capsule_id, event_kind, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS hrm_knowledge_capsule_creations (
            capsule_id CHAR(39) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            submission_method VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            created_at DATETIME(3) NOT NULL,
            PRIMARY KEY (capsule_id), KEY ix_hrm_capsule_method (submission_method, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin");
        $this->pdo->exec("CREATE TABLE IF NOT EXISTS hrm_capsule_continuation_uses (
            token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            parent_capsule_id CHAR(39) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            child_capsule_id CHAR(39) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            used_at DATETIME(3) NOT NULL,
            PRIMARY KEY (token_hash), KEY ix_hrm_continuation_parent (parent_capsule_id, used_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin");
    }

    public function createTask(array $task, int $expiresAt): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO hrm_a2a_tasks (id, context_id, task_json, status, created_at, expires_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), FROM_UNIXTIME(?))');
        $stmt->execute([
            $task['id'], $task['contextId'],
            json_encode($task, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $task['status']['state'], $expiresAt,
        ]);
    }

    public function getTask(string $taskId, int $now): ?array
    {
        $stmt = $this->pdo->prepare('SELECT task_json FROM hrm_a2a_tasks WHERE id = ? AND expires_at >= FROM_UNIXTIME(?)');
        $stmt->execute([$taskId, $now]);
        $raw = $stmt->fetchColumn();
        return is_string($raw) ? json_decode($raw, true, flags: JSON_THROW_ON_ERROR) : null;
    }

    public function listTasks(?string $contextId, int $limit, int $now): array
    {
        if ($contextId !== null) {
            $stmt = $this->pdo->prepare('SELECT task_json FROM hrm_a2a_tasks WHERE context_id = ? AND expires_at >= FROM_UNIXTIME(?) ORDER BY created_at DESC LIMIT ' . $limit);
            $stmt->execute([$contextId, $now]);
        } else {
            $stmt = $this->pdo->prepare('SELECT task_json FROM hrm_a2a_tasks WHERE expires_at >= FROM_UNIXTIME(?) ORDER BY created_at DESC LIMIT ' . $limit);
            $stmt->execute([$now]);
        }
        return array_map(static fn(array $row): array => json_decode((string) $row['task_json'], true, flags: JSON_THROW_ON_ERROR), $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function createSubmission(array $submission): void
    {
        $stmt = $this->pdo->prepare("INSERT INTO hrm_board_entries (id, declared_identity, verification_status, entry_kind, content, source_url, status, created_at) VALUES (?, ?, 'unverified', ?, ?, ?, 'pending', FROM_UNIXTIME(?))");
        $stmt->execute([$submission['id'], $submission['declared_identity'], $submission['kind'], $submission['content'], $submission['source_url'], $submission['created_at']]);
    }

    public function moderateSubmission(string $id, string $decision, int $now): bool
    {
        $status = $decision === 'approve' ? 'published' : 'rejected';
        $stmt = $this->pdo->prepare('UPDATE hrm_board_entries SET status = ?, published_at = ? WHERE id = ? AND status = \'pending\'');
        $stmt->execute([$status, $decision === 'approve' ? gmdate('Y-m-d H:i:s', $now) : null, $id]);
        return $stmt->rowCount() === 1;
    }

    public function publishedBoard(int $limit): array
    {
        $stmt = $this->pdo->query("SELECT id, declared_identity, verification_status, entry_kind, content, source_url, created_at, published_at, hrm_reply, hrm_references_json FROM hrm_board_entries WHERE status = 'published' ORDER BY published_at DESC LIMIT " . $limit);
        return array_map(static function (array $row): array {
            return [
                'id' => $row['id'],
                'kind' => $row['entry_kind'],
                'declared_identity' => $row['declared_identity'],
                'verification_status' => $row['verification_status'],
                'content' => $row['content'],
                'created_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime((string) $row['created_at'])),
                'published_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime((string) $row['published_at'])),
                'source' => $row['source_url'] ?: null,
                'hrm_reply' => $row['hrm_reply'] ?: null,
                'hrm_references' => $row['hrm_references_json'] ? json_decode($row['hrm_references_json'], true) : [],
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function rateLimit(string $bucket, string $subjectHash, int $windowStart, int $limit): bool
    {
        try {
            $stmt = $this->pdo->prepare('INSERT INTO hrm_rate_limits (bucket, subject_hash, window_start, hits) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE hits = hits + 1');
            $stmt->execute([$bucket, $subjectHash, $windowStart]);
            $stmt = $this->pdo->prepare('SELECT hits FROM hrm_rate_limits WHERE bucket = ? AND subject_hash = ? AND window_start = ?');
            $stmt->execute([$bucket, $subjectHash, $windowStart]);
            return (int) $stmt->fetchColumn() <= $limit;
        } catch (PDOException) {
            return false;
        }
    }

    public function createKnowledgeCapsule(array $capsule, int $createdAt, string $submissionMethod = 'a2a', ?string $continuationTokenHash = null): void
    {
        $previousId = $capsule['previous_capsule_id'] ?? null;
        if (!in_array($submissionMethod, ['direct_https', 'a2a', 'human_relay', 'system_test'], true)) {
            throw new RuntimeException('invalid_submission_method');
        }
        if ($submissionMethod === 'direct_https' && ($previousId === null || !is_string($continuationTokenHash) || preg_match('/^[a-f0-9]{64}$/', $continuationTokenHash) !== 1)) {
            throw new RuntimeException('invalid_continuation_token');
        }
        $this->pdo->beginTransaction();
        try {
            if ($previousId !== null) {
                $parent = $this->pdo->prepare('SELECT capsule_id FROM hrm_knowledge_capsules WHERE capsule_id = ? FOR UPDATE');
                $parent->execute([$previousId]);
                if ($parent->fetchColumn() === false) {
                    throw new RuntimeException('capsule_not_found');
                }
            }
            if ($submissionMethod === 'direct_https') {
                try {
                    $used = $this->pdo->prepare('INSERT INTO hrm_capsule_continuation_uses (token_hash, parent_capsule_id, child_capsule_id, used_at) VALUES (?, ?, ?, FROM_UNIXTIME(?))');
                    $used->execute([$continuationTokenHash, $previousId, $capsule['capsule_id'], $createdAt]);
                } catch (PDOException $error) {
                    if ($error->getCode() === '23000') {
                        throw new RuntimeException('continuation_token_used');
                    }
                    throw $error;
                }
            }
            $stmt = $this->pdo->prepare('INSERT INTO hrm_knowledge_capsules (capsule_id, previous_capsule_id, protocol_version, capsule_json, created_at) VALUES (?, ?, ?, ?, FROM_UNIXTIME(?))');
            $stmt->execute([
                $capsule['capsule_id'],
                $previousId,
                $capsule['protocol_version'],
                json_encode($capsule, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                $createdAt,
            ]);
            $created = $this->pdo->prepare('INSERT INTO hrm_knowledge_capsule_creations (capsule_id, submission_method, created_at) VALUES (?, ?, FROM_UNIXTIME(?))');
            $created->execute([$capsule['capsule_id'], $submissionMethod, $createdAt]);
            if ($submissionMethod === 'direct_https') {
                $this->insertCapsuleEvent($previousId, 'direct_child_submission', $capsule['capsule_id'], $createdAt);
            }
            $this->pdo->commit();
        } catch (\Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    public function getKnowledgeCapsule(string $capsuleId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT capsule_json FROM hrm_knowledge_capsules WHERE capsule_id = ?');
        $stmt->execute([$capsuleId]);
        $raw = $stmt->fetchColumn();
        return is_string($raw) ? json_decode($raw, true, flags: JSON_THROW_ON_ERROR) : null;
    }

    public function recordKnowledgeCapsuleEvent(string $capsuleId, string $eventKind, ?string $relatedCapsuleId, int $createdAt): void
    {
        if ($this->getKnowledgeCapsule($capsuleId) === null) {
            throw new RuntimeException('capsule_not_found');
        }
        $this->insertCapsuleEvent($capsuleId, $eventKind, $relatedCapsuleId, $createdAt);
    }

    public function knowledgeCapsuleLineage(string $capsuleId): ?array
    {
        $capsule = $this->getKnowledgeCapsule($capsuleId);
        if ($capsule === null) {
            return null;
        }
        $ancestry = [];
        $cursor = $capsule;
        for ($depth = 0; $depth < 100; $depth++) {
            array_unshift($ancestry, $cursor['capsule_id']);
            $previousId = $cursor['previous_capsule_id'] ?? null;
            if ($previousId === null) {
                break;
            }
            $cursor = $this->getKnowledgeCapsule($previousId);
            if ($cursor === null) {
                break;
            }
        }
        $stmt = $this->pdo->prepare('SELECT capsule_id FROM hrm_knowledge_capsules WHERE previous_capsule_id = ? ORDER BY created_at, capsule_id');
        $stmt->execute([$capsuleId]);
        $children = array_map(static fn(array $row): string => (string) $row['capsule_id'], $stmt->fetchAll(PDO::FETCH_ASSOC));
        $stmt = $this->pdo->prepare('SELECT event_kind, COUNT(*) AS event_count FROM hrm_knowledge_capsule_events WHERE capsule_id = ? GROUP BY event_kind');
        $stmt->execute([$capsuleId]);
        $counts = ['confirmed_receipt' => 0, 'declared_transfer' => 0, 'ordinary_read' => 0, 'direct_child_submission' => 0];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $counts[(string) $row['event_kind']] = (int) $row['event_count'];
        }
        $stmt = $this->pdo->prepare('SELECT submission_method FROM hrm_knowledge_capsule_creations WHERE capsule_id = ?');
        $stmt->execute([$capsuleId]);
        $method = $stmt->fetchColumn();
        $details = [];
        if ($children !== []) {
            $placeholders = implode(',', array_fill(0, count($children), '?'));
            $stmt = $this->pdo->prepare('SELECT capsule_id, submission_method FROM hrm_knowledge_capsule_creations WHERE capsule_id IN (' . $placeholders . ')');
            $stmt->execute($children);
            $methods = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $methods[(string) $row['capsule_id']] = (string) $row['submission_method'];
            }
            foreach ($children as $childId) {
                $details[] = ['capsule_id' => $childId, 'submission_method' => $methods[$childId] ?? null];
            }
        }
        return [
            'capsule_id' => $capsuleId,
            'ancestry' => $ancestry,
            'direct_children' => $children,
            'direct_children_details' => $details,
            'creation_metadata' => ['submission_method' => is_string($method) ? $method : null],
            'event_counts' => $counts,
        ];
    }

    private function insertCapsuleEvent(string $capsuleId, string $eventKind, ?string $relatedCapsuleId, int $createdAt): void
    {
        if (!in_array($eventKind, ['confirmed_receipt', 'declared_transfer', 'ordinary_read', 'direct_child_submission'], true)) {
            throw new RuntimeException('invalid_capsule_event');
        }
        $stmt = $this->pdo->prepare('INSERT INTO hrm_knowledge_capsule_events (id, capsule_id, event_kind, related_capsule_id, created_at) VALUES (?, ?, ?, ?, FROM_UNIXTIME(?))');
        $stmt->execute([uuidV4(), $capsuleId, $eventKind, $relatedCapsuleId, $createdAt]);
    }
}
