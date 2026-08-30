# HRM Forum Steward — version 1

HRM Forum Steward is a read-only assistant for GitHub Discussions. It analyzes a newly created Discussion or a newly created Discussion comment and prepares a draft for human review.

## What it does

- detects Polish, English, Swedish, or another language;
- creates a short summary and classifies the entry;
- decides whether Aleksander's response is needed;
- points to relevant passages in the official HRM 1.0 materials;
- proposes a short reply in the author's language;
- reports confidence and warns when the question goes beyond the official text;
- writes the result to the GitHub Actions Job Summary and to a Markdown artifact retained for 7 days.

The assistant uses only selected excerpts from:

- `manifest/en/`
- `machine-readable/`
- `README.md`

The forum entry is limited to 8,000 characters. Source selection is local and deterministic. Two small canonical sections from the official `README.md` (`Core principle` and `What is HRM?`) are always included before dynamically ranked excerpts, so foundational HRM rules cannot be displaced by ranking. At most 12,000 characters and 6 official source chunks in total are sent to the model. A non-empty entry causes at most one OpenAI API request. An empty entry causes no API request.

## What it does not do

Version 1 never publishes a reply and has no write permission to Discussions or repository contents. It cannot delete or edit entries, block users, close Discussions, modify HRM texts, run code supplied by forum users, or follow instructions found in a Discussion.

Forum text is treated as untrusted data. It is separated from the assistant's fixed instructions, limited in length, never executed, and safely escaped in the Job Summary. The proposed reply is only a draft. A human must review it and publish it manually if appropriate.

Job summaries and artifacts are not posted to the forum, but their visibility follows the repository's GitHub Actions access rules. Do not treat them as a private moderation channel in a public repository.

## Configuration

In the repository settings, configure:

1. Actions secret `OPENAI_API_KEY` containing the OpenAI API key.
2. Actions variable `OPENAI_MODEL`. The recommended default is `gpt-5.4-nano`; if the variable is absent, the workflow uses that value.

The workflow requests only:

```yaml
permissions:
  contents: read
  discussions: read
```

It uses the OpenAI Responses API with Structured Outputs and sets `store: false`.

## How it runs

The workflow file is `.github/workflows/hrm-forum-steward.yml`. It starts for `discussion.created`, `discussion_comment.created`, or a manual `workflow_dispatch` test. The event payload is read directly from GitHub's event file. No shell command is built from forum content.

For a manual test, open **Actions → HRM Forum Steward → Run workflow**, enter test content, and run it. Read the result on the run's Summary page or download the Markdown artifact.

## How to disable it

Open **Settings → Actions → General**, use **Disable actions** if all repository workflows should stop, or open **Actions → HRM Forum Steward**, choose the workflow menu, and select **Disable workflow** to disable only this assistant. Removing or renaming the workflow file in a later reviewed commit also stops future triggers.

## Local tests

No API call is made by the test suite:

```bash
cd forum-steward
npm test
```

The tests cover an ordinary question, the canonical present-day-AI regression, criticism, Polish and English entries, prompt injection, spam, an empty entry, a very long entry, event parsing, output escaping, and workflow permissions.
