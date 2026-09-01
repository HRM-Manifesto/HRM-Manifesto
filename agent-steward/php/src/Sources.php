<?php
declare(strict_types=1);

namespace Hrm\Steward;

final class SourceCatalog
{
    public function __construct(private readonly array $sources)
    {
        if ($sources === []) {
            throw new \RuntimeException('Official HRM source index is empty');
        }
    }

    public function search(string $query, int $limit = 4): array
    {
        $terms = $this->terms($query);
        $ranked = [];
        foreach ($this->sources as $index => $source) {
            $haystack = mb_strtolower((string) ($source['title'] . ' ' . $source['section'] . ' ' . $source['text']), 'UTF-8');
            $score = 0;
            foreach ($terms as $term) {
                $score += substr_count($haystack, $term) * (mb_strlen($term, 'UTF-8') > 5 ? 3 : 1);
            }
            if ($score > 0) {
                $ranked[] = ['score' => $score, 'index' => $index, 'source' => $source];
            }
        }
        usort($ranked, static fn(array $a, array $b): int => $b['score'] <=> $a['score'] ?: $a['index'] <=> $b['index']);
        return array_map(static fn(array $item): array => $item['source'], array_slice($ranked, 0, $limit));
    }

    public function byDocument(string $document, int $limit = 4): array
    {
        return array_slice(array_values(array_filter(
            $this->sources,
            static fn(array $source): bool => ($source['document'] ?? '') === $document,
        )), 0, $limit);
    }

    private function terms(string $value): array
    {
        $words = preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower($value, 'UTF-8'), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $stop = ['about','and','are','czy','dla','does','from','hrm','how','jest','oraz','the','this','what','with'];
        return array_values(array_unique(array_filter($words, static fn(string $word): bool => mb_strlen($word, 'UTF-8') >= 3 && !in_array($word, $stop, true))));
    }
}
