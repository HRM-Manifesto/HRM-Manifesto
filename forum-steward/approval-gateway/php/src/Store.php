<?php
declare(strict_types=1);

namespace Hrm\Gateway;

use PDO;
use PDOException;
use RuntimeException;

interface GatewayStore
{
    public function createCase(string $notificationKey, string $tokenHash, ApprovalRecord $record): bool;
    public function peek(string $tokenHash, int $now): array;
    public function claim(string $tokenHash, int $now): array;
    public function complete(string $tokenHash, string $status, ?string $resultUrl = null): void;
    public function fail(string $tokenHash): void;
}

final class PdoGatewayStore implements GatewayStore
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
        return new self(new PDO($dsn, $database['user'], $database['password'], [
            PDO::ATTR_TIMEOUT => 10,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]));
    }

    public function createCase(string $notificationKey, string $tokenHash, ApprovalRecord $record): bool
    {
        $sql = 'INSERT INTO hrm_approval_cases '
            . '(notification_key, token_hash, repository_name, target, proposed_polish_reply, has_proposed_reply, approval_hash, status, expires_at) '
            . "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', FROM_UNIXTIME(?))";
        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                $notificationKey, $tokenHash, $record->repository, $record->target,
                $record->proposedPolishReply, $record->hasProposedReply ? 1 : 0,
                $record->approvalHash, $record->expiresAt,
            ]);
            return true;
        } catch (PDOException $error) {
            if ((string) $error->getCode() === '23000') {
                $stmt = $this->pdo->prepare('SELECT notification_key FROM hrm_approval_cases WHERE notification_key = ?');
                $stmt->execute([$notificationKey]);
                if ($stmt->fetchColumn() !== false) {
                    return false;
                }
            }
            throw $error;
        }
    }

    public function peek(string $tokenHash, int $now): array
    {
        $stmt = $this->pdo->prepare('SELECT repository_name, target, proposed_polish_reply, has_proposed_reply, approval_hash, status, UNIX_TIMESTAMP(expires_at) AS expires_at, result_url FROM hrm_approval_cases WHERE token_hash = ?');
        $stmt->execute([$tokenHash]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return ['kind' => 'missing'];
        }
        if ((int) $row['expires_at'] < $now) {
            return ['kind' => 'expired'];
        }
        if ($row['status'] !== 'pending') {
            return ['kind' => 'used', 'status' => $row['status'], 'result_url' => $row['result_url']];
        }
        return ['kind' => 'active', 'record' => $this->recordFromRow($row, $now)];
    }

    public function claim(string $tokenHash, int $now): array
    {
        $stmt = $this->pdo->prepare("UPDATE hrm_approval_cases SET status = 'processing', decided_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND status = 'pending' AND expires_at >= FROM_UNIXTIME(?)");
        $stmt->execute([$tokenHash, $now]);
        if ($stmt->rowCount() !== 1) {
            return $this->peek($tokenHash, $now);
        }
        $stmt = $this->pdo->prepare('SELECT repository_name, target, proposed_polish_reply, has_proposed_reply, approval_hash, UNIX_TIMESTAMP(expires_at) AS expires_at FROM hrm_approval_cases WHERE token_hash = ?');
        $stmt->execute([$tokenHash]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            throw new RuntimeException('Claimed gateway case disappeared');
        }
        return ['kind' => 'claimed', 'record' => $this->recordFromRow($row, $now)];
    }

    public function complete(string $tokenHash, string $status, ?string $resultUrl = null): void
    {
        if (!in_array($status, ['published', 'rejected', 'duplicate', 'invalid'], true)) {
            throw new RuntimeException('Invalid completion status');
        }
        $stmt = $this->pdo->prepare('UPDATE hrm_approval_cases SET status = ?, result_url = ?, decided_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND status = \'processing\'');
        $stmt->execute([$status, $resultUrl, $tokenHash]);
        if ($stmt->rowCount() !== 1) {
            throw new RuntimeException('Gateway case is not processing');
        }
    }

    public function fail(string $tokenHash): void
    {
        $stmt = $this->pdo->prepare("UPDATE hrm_approval_cases SET status = 'failed', decided_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND status = 'processing'");
        $stmt->execute([$tokenHash]);
    }

    private function recordFromRow(array $row, int $now): ApprovalRecord
    {
        return new ApprovalRecord(
            (string) $row['repository_name'],
            (string) $row['target'],
            (string) $row['proposed_polish_reply'],
            (bool) $row['has_proposed_reply'],
            (string) $row['approval_hash'],
            $now,
            (int) $row['expires_at'],
        );
    }
}
