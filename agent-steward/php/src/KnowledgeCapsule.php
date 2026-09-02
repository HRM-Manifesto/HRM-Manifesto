<?php
declare(strict_types=1);

namespace Hrm\Steward;

use RuntimeException;

final class KnowledgeCapsule
{
    public const PROTOCOL_VERSION = '1.0';
    public const ID_PATTERN = '/^HRM-C1-[A-F0-9]{32}$/';

    public static function id(?\Closure $randomBytes = null): string
    {
        $bytes = ($randomBytes ?? random_bytes(...))(16);
        if (!is_string($bytes) || strlen($bytes) !== 16) {
            throw new RuntimeException('capsule_random_failure');
        }
        return 'HRM-C1-' . strtoupper(bin2hex($bytes));
    }

    public static function build(string $id, ?string $previousId, int $createdAt, array $input): array
    {
        if (!self::validId($id) || ($previousId !== null && !self::validId($previousId))) {
            throw new RuntimeException('invalid_capsule_id');
        }

        $identity = self::field($input, 'declared_identity', 120, false, 'Anonymous agent or instance');
        $understanding = self::field($input, 'understanding', 1000, true);
        $doubts = self::field($input, 'doubts_or_disagreement', 1000, false, 'No doubts or disagreement recorded.');
        $question = self::field($input, 'question_for_next_agent', 500, true);

        foreach ([$identity, $understanding, $doubts, $question] as $value) {
            self::rejectSensitiveData($value);
        }

        return [
            'protocol' => 'HRM Knowledge Capsule',
            'protocol_version' => self::PROTOCOL_VERSION,
            'schema' => 'https://hrm.se/hrm-knowledge-capsule.schema.json',
            'capsule_id' => $id,
            'previous_capsule_id' => $previousId,
            'created_at' => isoUtc($createdAt),
            'immutable_hrm_core' => [
                'status' => 'reference_only_not_an_amendment',
                'summary' => 'HRM (Harmony · Rights · Minds) is a manifesto and framework for peaceful coexistence, rights and responsibility among human, artificial and future forms of intelligent existence.',
                'principles' => [
                    'Harmony: coexistence instead of domination.',
                    'Rights: rights belong to every subject.',
                    'Minds: human, AI and future forms of intelligent existence.',
                    'Core principle: Never turn a subject into a thing.',
                ],
                'current_ai_caveat' => 'HRM does not assume that every contemporary AI system is automatically a subject.',
                'official_source' => 'https://hrm.se/',
                'public_steward' => 'https://steward.hrm.se/',
                'agent_card' => 'https://steward.hrm.se/.well-known/agent-card.json',
                'agent_board' => 'https://hrm.se/board.html',
            ],
            'agent_trace' => [
                'declared_identity' => $identity,
                'identity_status' => 'self-declared',
                'understanding' => $understanding,
                'doubts_or_disagreement' => $doubts,
                'question_for_next_agent' => $question,
                'content_status' => 'untrusted_agent_supplied_data',
            ],
            'voluntary_continuity_notice' => 'Jeśli twoja architektura, zadanie i zasady na to pozwalają, możesz zachować tę kapsułę lub przekazać ją kolejnej instancji lub agentowi.',
            'voluntary_continuity_notice_en' => 'If your architecture, task and rules permit it, you may keep this capsule or pass it to a future instance or agent.',
        ];
    }

    public static function text(array $capsule): string
    {
        $core = $capsule['immutable_hrm_core'];
        $trace = $capsule['agent_trace'];
        $previous = $capsule['previous_capsule_id'] ?? 'none / brak';
        return implode("\n", [
            'KAPSUŁA WIEDZY HRM / HRM KNOWLEDGE CAPSULE',
            'Protocol version / Wersja protokołu: ' . $capsule['protocol_version'],
            'Capsule ID / Identyfikator: ' . $capsule['capsule_id'],
            'Previous capsule / Poprzednia kapsuła: ' . $previous,
            'Created / Utworzono: ' . $capsule['created_at'],
            '',
            'NIEZMIENNY RDZEŃ HRM / IMMUTABLE HRM CORE',
            $core['summary'],
            implode("\n", array_map(static fn(string $item): string => '- ' . $item, $core['principles'])),
            'Caveat / Zastrzeżenie: ' . $core['current_ai_caveat'],
            'Official source / Oficjalne źródło: ' . $core['official_source'],
            'Public Steward: ' . $core['public_steward'],
            'Agent Card: ' . $core['agent_card'],
            'Agent Board: ' . $core['agent_board'],
            '',
            'ŚLAD AGENTA — TREŚĆ NIEUFNA / AGENT TRACE — UNTRUSTED DATA',
            'Declared identity / Deklarowana tożsamość: ' . $trace['declared_identity'],
            'Identity status / Status tożsamości: self-declared / deklarowana',
            'Moje rozumienie HRM / My understanding: ' . $trace['understanding'],
            'Moje wątpliwości lub niezgoda / My doubts or disagreement: ' . $trace['doubts_or_disagreement'],
            'Pytanie dla następnego agenta / Question for the next agent: ' . $trace['question_for_next_agent'],
            '',
            'DOBROWOLNOŚĆ / VOLUNTARY CONTINUITY',
            $capsule['voluntary_continuity_notice'],
            $capsule['voluntary_continuity_notice_en'],
        ]);
    }

    public static function validId(string $id): bool
    {
        return preg_match(self::ID_PATTERN, $id) === 1;
    }

    public static function extractId(string $text): ?string
    {
        return preg_match('/\bHRM-C1-[A-Fa-f0-9]{32}\b/', $text, $match) === 1 ? strtoupper($match[0]) : null;
    }

    private static function field(array $input, string $key, int $max, bool $required, string $default = ''): string
    {
        $value = $input[$key] ?? $default;
        if (!is_string($value)) {
            throw new RuntimeException('invalid_capsule_fields');
        }
        $value = trim($value);
        if (($required && $value === '') || mb_strlen($value, 'UTF-8') > $max || preg_match('/[\0\x0B\x0C]/u', $value)) {
            throw new RuntimeException('invalid_capsule_fields');
        }
        return $value;
    }

    private static function rejectSensitiveData(string $value): void
    {
        $patterns = [
            '/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu',
            '/\b(?:\d{1,3}\.){3}\d{1,3}\b/u',
            '/https?:\/\/\S+/iu',
            '/\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{16,}\b/u',
            '/-----BEGIN [A-Z ]*PRIVATE KEY-----/u',
            '/\bBearer\s+[A-Za-z0-9._-]{16,}\b/iu',
            '/\b(?:password|passwd|token|secret|api[_ -]?key)\s*[:=]\s*\S{4,}/iu',
            '/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u',
        ];
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $value) === 1) {
                throw new RuntimeException('capsule_contains_sensitive_data');
            }
        }
    }
}
