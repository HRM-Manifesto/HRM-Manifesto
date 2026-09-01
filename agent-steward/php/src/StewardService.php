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
            default => $this->undetermined(),
        };
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
        $allowed = ['explain_hrm', 'find_hrm_source', 'explain_subjecthood', 'explain_rights_and_responsibilities', 'critique_hrm', 'read_agent_board', 'submit_message'];
        if (in_array($skill, $allowed, true)) {
            return $skill;
        }
        $lower = mb_strtolower($text, 'UTF-8');
        return match (true) {
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
