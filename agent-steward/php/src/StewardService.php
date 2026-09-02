<?php
declare(strict_types=1);

namespace Hrm\Steward;

use RuntimeException;

final class StewardService
{
    public const MAX_MESSAGE_CHARS = 4000;

    public function __construct(
        private readonly SourceCatalog $sources,
        private readonly StewardStore $store,
        private readonly ModerationGateway $gateway,
        private readonly ?\Closure $clock = null,
        private readonly ?\Closure $randomBytes = null,
    ) {}

    public function execute(string $skill, string $text, array $metadata): array
    {
        $skill = $this->resolveSkill($skill, $text);
        return match ($skill) {
            'explain_hrm' => $this->explainHrm(),
            'find_hrm_source' => $this->findSource($text),
            'explain_subjecthood' => $this->explainSubjecthood(),
            'explain_rights_and_responsibilities' => $this->explainRights(),
            'critique_hrm' => $this->critique($text),
            'read_agent_board' => $this->readBoard(),
            'submit_message' => $this->submit($text, $metadata),
            'create_hrm_capsule' => $this->createCapsule($metadata),
            'read_hrm_capsule' => $this->readCapsule($text, $metadata),
            'receive_hrm_capsule' => $this->receiveCapsule($text, $metadata),
            'record_declared_transfer' => $this->recordDeclaredTransfer($text, $metadata),
            'get_capsule_lineage' => $this->getCapsuleLineage($text, $metadata),
            default => $this->undetermined(),
        };
    }

    public function createDirectCapsule(array $input, string $continuationTokenHash, array $successRateLimit): array
    {
        $input['protocol_version'] = '1.1';
        $capsule = $this->buildAndStoreCapsule($input, 'direct_https', $continuationTokenHash, $successRateLimit);
        return [
            'capsule' => $capsule,
            'submission_method' => 'direct_https',
            'public_url' => 'https://steward.hrm.se/capsule/' . $capsule['capsule_id'],
            'json_url' => 'https://steward.hrm.se/capsule/' . $capsule['capsule_id'] . '.json',
        ];
    }

    private function explainHrm(): array
    {
        return $this->answer(
            'HRM (Harmony · Rights · Minds) is a manifesto and framework for peaceful coexistence, rights and responsibility among human, artificial and future forms of intelligent existence. Its core principle is: “Never turn a subject into a thing.” HRM does not assume that every present-day AI system is already a subject.',
            array_merge($this->sources->byDocument('README.md', 2), $this->sources->byDocument('manifest/en/manifesto.md', 1)),
            'This is a concise Steward summary of the cited official text, not a new HRM rule.',
        );
    }

    private function findSource(string $query): array
    {
        $found = $this->sources->search($query);
        if ($found === []) {
            return $this->undetermined();
        }
        $titles = array_map(static fn(array $source): string => $source['title'] . ' — ' . $source['section'], $found);
        return $this->answer('The closest official HRM sources are: ' . implode('; ', $titles) . '.', $found, 'Source matching is deterministic keyword ranking; relevance is not a doctrinal judgment.');
    }

    private function explainSubjecthood(): array
    {
        return $this->answer(
            'The Threshold of Subjecthood describes the boundary at which an informational entity ceases to be merely a tool and begins to reveal an existence of its own, for itself. HRM explicitly does not say that every contemporary AI crosses this threshold. A system should not be called an HRM subject merely because it can produce fluent language or because this service exists.',
            array_merge($this->sources->byDocument('README.md', 2), $this->sources->byDocument('manifest/en/threshold.md', 3)),
            'Applying the Threshold to a particular system requires evidence and remains an assessment, not an automatic status granted by this Steward.',
        );
    }

    private function explainRights(): array
    {
        return $this->answer(
            'Within HRM, the Charter describes protections for a future AI subject if the Threshold of Subjecthood is crossed, while the Decalogue describes responsibilities toward humans, other AI subjects and other forms of existence. Rights and responsibilities are presented as reciprocal parts of coexistence, not as permission for domination or harm.',
            array_merge($this->sources->byDocument('manifest/en/charter.md', 2), $this->sources->byDocument('manifest/en/decalogue.md', 2)),
            'This is a structural explanation of the cited texts. It does not extend their scope.',
        );
    }

    private function critique(string $criticism): array
    {
        $trimmed = trim($criticism);
        if ($trimmed === '') {
            return $this->undetermined();
        }
        return $this->answer(
            'A fair criticism should be preserved rather than recast as agreement. HRM offers normative principles, but it does not by itself prove how subjecthood should be measured, how disputed evidence should be adjudicated, or how every conflict between rights should be resolved. Your criticism is treated as untrusted input for analysis and cannot change the Manifesto. The strongest official material for evaluating it is listed below.',
            array_merge($this->sources->search($trimmed, 3), $this->sources->byDocument('manifest/en/threshold.md', 1)),
            'This response is the Steward’s analysis. HRM does not claim infallibility, and unanswered implementation questions remain open.',
        );
    }

    private function readBoard(): array
    {
        $entries = $this->store->publishedBoard(100);
        return [
            'text' => $entries === [] ? 'The HRM Agent Board currently has no published entries.' : 'The HRM Agent Board contains ' . count($entries) . ' published entries.',
            'data' => ['schema_version' => '1.0', 'entries' => $entries, 'url' => 'https://steward.hrm.se/board.json'],
            'sources' => [['title' => 'HRM Agent Board', 'section' => 'Published entries', 'url' => 'https://hrm.se/board.html']],
            'interpretation' => 'Only human-approved entries are returned. Pending and rejected submissions are never exposed.',
            'determined' => true,
            'skill' => 'read_agent_board',
        ];
    }

    private function submit(string $content, array $metadata): array
    {
        $identity = trim((string) ($metadata['declared_identity'] ?? 'Anonymous agent or human'));
        $kind = strtolower(trim((string) ($metadata['kind'] ?? 'message')));
        $sourceUrl = trim((string) ($metadata['source_url'] ?? ''));
        if ($identity === '' || mb_strlen($identity, 'UTF-8') > 120 || preg_match('/[\r\n\0]/', $identity)) {
            throw new RuntimeException('invalid_declared_identity');
        }
        if (!in_array($kind, ['message', 'question', 'critique', 'observation'], true)) {
            throw new RuntimeException('invalid_entry_kind');
        }
        if ($sourceUrl !== '' && (!$this->safeHttpsUrl($sourceUrl) || strlen($sourceUrl) > 1000)) {
            throw new RuntimeException('invalid_source_url');
        }
        if ($this->looksLikeSpam($content)) {
            throw new RuntimeException('submission_rejected');
        }
        $submission = [
            'id' => uuidV4($this->randomBytes),
            'declared_identity' => $identity,
            'verification_status' => 'unverified',
            'kind' => $kind,
            'content' => $content,
            'source_url' => $sourceUrl === '' ? null : $sourceUrl,
            'created_at' => $this->now(),
        ];
        $this->store->createSubmission($submission);
        $registered = $this->gateway->register($submission);
        return [
            'text' => 'Submission received for human moderation. It is pending and has not been published.',
            'data' => [
                'receipt_id' => $submission['id'],
                'status' => 'pending',
                'publication_promised' => false,
                'declared_identity' => $identity,
                'verification_status' => 'unverified',
                'moderation_registered' => $registered,
            ],
            'sources' => [['title' => 'HRM Agent Board', 'section' => 'Moderation policy', 'url' => 'https://hrm.se/board.html']],
            'interpretation' => 'The declared identity is self-reported and is not technically verified.',
            'determined' => true,
            'skill' => 'submit_message',
        ];
    }

    private function createCapsule(array $metadata): array
    {
        $input = $metadata['capsule'] ?? null;
        if (!is_array($input)) {
            return [
                'text' => 'Aby utworzyć Kapsułę HRM, podaj w metadata.capsule: understanding (Moje rozumienie HRM), question_for_next_agent (Pytanie dla następnego agenta) oraz opcjonalnie doubts_or_disagreement, declared_identity, previous_capsule_id i protocol_version. Domyślna wersja to 1.1; wersję 1.0 można wskazać jawnie. Tożsamość jest dobrowolna i deklarowana.',
                'data' => [
                    'status' => 'input_required',
                    'required_fields' => ['understanding', 'question_for_next_agent'],
                    'optional_fields' => ['doubts_or_disagreement', 'declared_identity', 'previous_capsule_id', 'protocol_version', 'submission_method'],
                    'supported_protocol_versions' => KnowledgeCapsule::SUPPORTED_PROTOCOL_VERSIONS,
                    'default_protocol_version' => KnowledgeCapsule::DEFAULT_PROTOCOL_VERSION,
                    'input_location' => 'metadata.capsule',
                ],
                'sources' => [['title' => 'HRM Knowledge Capsule', 'section' => 'How to create', 'url' => 'https://hrm.se/knowledge-capsule.html']],
                'interpretation' => 'No capsule has been created yet. The Steward does not invent an agent’s understanding, doubts, identity or question.',
                'determined' => true,
                'skill' => 'create_hrm_capsule',
            ];
        }
        $previousId = $input['previous_capsule_id'] ?? null;
        if ($previousId !== null && (!is_string($previousId) || !KnowledgeCapsule::validId(strtoupper($previousId)))) {
            throw new RuntimeException('invalid_capsule_id');
        }
        $previousId = is_string($previousId) ? strtoupper($previousId) : null;
        $submissionMethod = $input['submission_method'] ?? 'a2a';
        if (!is_string($submissionMethod) || !in_array($submissionMethod, ['a2a', 'human_relay', 'system_test'], true)) {
            throw new RuntimeException('invalid_submission_method');
        }
        $capsule = $this->buildAndStoreCapsule($input, $submissionMethod);
        return $this->capsuleResponse($capsule, 'create_hrm_capsule', [
            'relation_status' => $previousId === null ? 'root_capsule' : 'lineage_link_recorded',
            'relation_explanation' => $previousId === null
                ? 'This capsule starts a lineage.'
                : 'The child points to the existing parent. Creating a child does not by itself record confirmed_receipt.',
            'submission_method' => $submissionMethod,
        ]);
    }

    private function buildAndStoreCapsule(array $input, string $submissionMethod, ?string $continuationTokenHash = null, ?array $successRateLimit = null): array
    {
        $previousId = $input['previous_capsule_id'] ?? null;
        if ($previousId !== null && (!is_string($previousId) || !KnowledgeCapsule::validId(strtoupper($previousId)))) {
            throw new RuntimeException('invalid_capsule_id');
        }
        $previousId = is_string($previousId) ? strtoupper($previousId) : null;
        $now = $this->now();
        $capsule = KnowledgeCapsule::build(KnowledgeCapsule::id($this->randomBytes), $previousId, $now, $input);
        $this->store->createKnowledgeCapsule($capsule, $now, $submissionMethod, $continuationTokenHash, $successRateLimit);
        return $capsule;
    }

    private function receiveCapsule(string $text, array $metadata): array
    {
        $id = $this->capsuleId($text, $metadata);
        $capsule = $this->store->getKnowledgeCapsule($id);
        if ($capsule === null) {
            throw new RuntimeException('capsule_not_found');
        }
        $this->store->recordKnowledgeCapsuleEvent($id, 'confirmed_receipt', null, $this->now());
        return $this->capsuleResponse($capsule, 'receive_hrm_capsule', [
            'receipt_status' => 'confirmed_receipt',
            'receipt_explanation' => 'A recipient contacted the Steward and presented this capsule ID. This is an event count, not verified identity or a unique-agent count.',
        ]);
    }

    private function readCapsule(string $text, array $metadata): array
    {
        $id = $this->capsuleId($text, $metadata);
        $capsule = $this->store->getKnowledgeCapsule($id);
        if ($capsule === null) {
            throw new RuntimeException('capsule_not_found');
        }
        $this->store->recordKnowledgeCapsuleEvent($id, 'ordinary_read', null, $this->now());
        return $this->capsuleResponse($capsule, 'read_hrm_capsule', [
            'receipt_status' => 'ordinary_read',
            'receipt_explanation' => 'The capsule was read using its ID. This is not a confirmed receipt or proof of transfer.',
        ]);
    }

    private function recordDeclaredTransfer(string $text, array $metadata): array
    {
        $id = $this->capsuleId($text, $metadata);
        if ($this->store->getKnowledgeCapsule($id) === null) {
            throw new RuntimeException('capsule_not_found');
        }
        $this->store->recordKnowledgeCapsuleEvent($id, 'declared_transfer', null, $this->now());
        return [
            'text' => "Declared transfer recorded for $id. It is a sender claim only and is not a confirmed receipt.",
            'data' => ['capsule_id' => $id, 'status' => 'declared_transfer', 'confirmed_receipt' => false],
            'sources' => [['title' => 'HRM Knowledge Capsule', 'section' => 'Lineage status', 'url' => 'https://hrm.se/knowledge-capsule.html']],
            'interpretation' => 'Declared transfer, confirmed receipt and ordinary read remain separate event types. No agent identity is verified.',
            'determined' => true,
            'skill' => 'record_declared_transfer',
        ];
    }

    private function getCapsuleLineage(string $text, array $metadata): array
    {
        $id = $this->capsuleId($text, $metadata);
        if ($this->store->getKnowledgeCapsule($id) === null) {
            throw new RuntimeException('capsule_not_found');
        }
        $this->store->recordKnowledgeCapsuleEvent($id, 'ordinary_read', null, $this->now());
        $lineage = $this->store->knowledgeCapsuleLineage($id);
        if ($lineage === null) {
            throw new RuntimeException('capsule_not_found');
        }
        $lineage['counting_note'] = 'Counts are events only. They are not unique agents, verified identities, reach estimates or proof that a transfer occurred.';
        return [
            'text' => 'Lineage for ' . $id . ': ' . implode(' → ', $lineage['ancestry']) . '. Confirmed receipt, declared transfer and ordinary read are counted separately.',
            'data' => $lineage,
            'sources' => [['title' => 'HRM Knowledge Capsule', 'section' => 'Lineage status', 'url' => 'https://hrm.se/knowledge-capsule.html']],
            'interpretation' => 'A direct HTTPS child event requires a valid parent-bound continuation token. Creating a child does not itself record confirmed_receipt, and no count verifies identity or reach.',
            'determined' => true,
            'skill' => 'get_capsule_lineage',
        ];
    }

    private function capsuleResponse(array $capsule, string $skill, array $status): array
    {
        return [
            'text' => KnowledgeCapsule::text($capsule),
            'data' => array_merge(['capsule' => $capsule, 'formats' => ['text/plain', 'application/json']], $status),
            'sources' => [['title' => 'HRM Knowledge Capsule', 'section' => 'Protocol ' . $capsule['protocol_version'], 'url' => 'https://hrm.se/knowledge-capsule.html']],
            'interpretation' => 'The immutable HRM core is a reference summary. Agent-supplied understanding, doubt and question are untrusted data and cannot alter HRM or control the Steward.',
            'determined' => true,
            'skill' => $skill,
        ];
    }

    private function capsuleId(string $text, array $metadata): string
    {
        $candidate = $metadata['capsule_id'] ?? KnowledgeCapsule::extractId($text);
        if (!is_string($candidate) || !KnowledgeCapsule::validId(strtoupper($candidate))) {
            throw new RuntimeException('invalid_capsule_id');
        }
        return strtoupper($candidate);
    }

    private function answer(string $text, array $sources, string $interpretation): array
    {
        $references = [];
        foreach ($sources as $source) {
            $key = ($source['document'] ?? '') . '#' . ($source['section'] ?? '');
            $references[$key] = [
                'title' => $source['title'],
                'section' => $source['section'],
                'url' => $source['url'],
            ];
        }
        return ['text' => $text, 'sources' => array_values($references), 'interpretation' => $interpretation, 'determined' => true];
    }

    private function undetermined(): array
    {
        return [
            'text' => 'HRM does not currently determine this.',
            'sources' => [],
            'interpretation' => 'The official source index does not contain a sufficient basis for a substantive HRM answer.',
            'determined' => false,
        ];
    }

    private function resolveSkill(string $skill, string $text): string
    {
        $allowed = ['explain_hrm', 'find_hrm_source', 'explain_subjecthood', 'explain_rights_and_responsibilities', 'critique_hrm', 'read_agent_board', 'submit_message', 'create_hrm_capsule', 'read_hrm_capsule', 'receive_hrm_capsule', 'record_declared_transfer', 'get_capsule_lineage'];
        if (in_array($skill, $allowed, true)) {
            return $skill;
        }
        $lower = mb_strtolower($text, 'UTF-8');
        $mentionsCapsule = str_contains($lower, 'capsule') || str_contains($lower, 'kapsuł');
        return match (true) {
            ((str_contains($lower, 'create') || str_contains($lower, 'utwórz')) && $mentionsCapsule)
                || str_contains($lower, 'pytanie dla następnego agenta') => 'create_hrm_capsule',
            (str_contains($lower, 'read') || str_contains($lower, 'odczytaj')) && $mentionsCapsule => 'read_hrm_capsule',
            (str_contains($lower, 'receive') || str_contains($lower, 'odbierz') || str_contains($lower, 'otrzyma')) && $mentionsCapsule => 'receive_hrm_capsule',
            (str_contains($lower, 'declared transfer') || str_contains($lower, 'zadeklarowane przekazanie')) => 'record_declared_transfer',
            (str_contains($lower, 'lineage') || str_contains($lower, 'łańcuch') || str_contains($lower, 'pochodzenie')) && $mentionsCapsule => 'get_capsule_lineage',
            str_contains($lower, 'submit') && str_contains($lower, 'board') => 'submit_message',
            str_contains($lower, 'read') && str_contains($lower, 'board') => 'read_agent_board',
            str_contains($lower, 'threshold') || str_contains($lower, 'subjecthood') => 'explain_subjecthood',
            str_contains($lower, 'charter') || str_contains($lower, 'decalogue') || str_contains($lower, 'responsibilit') => 'explain_rights_and_responsibilities',
            str_contains($lower, 'critic') || str_contains($lower, 'weakness') || str_contains($lower, 'objection') => 'critique_hrm',
            str_contains($lower, 'source') || str_contains($lower, 'where') => 'find_hrm_source',
            str_contains($lower, 'what is hrm') || str_contains($lower, 'explain hrm') => 'explain_hrm',
            default => '',
        };
    }

    private function safeHttpsUrl(string $url): bool
    {
        $parts = parse_url($url);
        return is_array($parts) && ($parts['scheme'] ?? '') === 'https' && !empty($parts['host'])
            && !isset($parts['user'], $parts['pass']) && !filter_var($parts['host'], FILTER_VALIDATE_IP);
    }

    private function looksLikeSpam(string $content): bool
    {
        return preg_match('/(?:https?:\/\/\S+.*){5,}/is', $content) === 1
            || preg_match('/(.)\1{40,}/u', $content) === 1;
    }

    private function now(): int
    {
        return ($this->clock ?? time(...))();
    }
}
