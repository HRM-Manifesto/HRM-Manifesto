# HRM Forum Steward v2

HRM Forum Steward v2 pomaga Aleksandrowi bezpiecznie obsługiwać GitHub Discussions. Analiza i publikacja są rozdzielone na dwa osobne workflow.

Najważniejsza zasada: pojawienie się wpisu lub komentarza **nigdy nie publikuje odpowiedzi automatycznie**.

## Automatic analysis

Workflow `.github/workflows/hrm-forum-steward.yml` uruchamia się po utworzeniu Discussion, utworzeniu komentarza albo przez ręczny test `workflow_dispatch`.

Ma wyłącznie uprawnienia:

```yaml
permissions:
  contents: read
  discussions: read
```

Dla jednego wpisu przygotowuje link, autora, język, analizowany oryginał, pełne tłumaczenie na polski, polskie streszczenie, klasyfikację, ważność, pewność, źródła HRM oraz propozycję odpowiedzi zawsze po polsku.

Jeżeli wpis jest po polsku, pole tłumaczenia zawiera dokładny oryginał. Wierne tłumaczenie jednoznacznej zasady HRM nie jest oznaczane jako interpretacja.

## Polish review workflow

Aleksander zawsze ocenia wersję polską, niezależnie od języka autora. Może ją zaakceptować, poprawić albo zrezygnować z odpowiedzi.

Analiza trafia do Job Summary, artefaktu Markdown przechowywanego przez 7 dni oraz e-maila, jeśli powiadomienia są włączone. Nie jest publikowana na forum. W publicznym repozytorium Job Summary i artefaktu nie należy jednak traktować jak prywatnego kanału moderacyjnego.

## Email notifications

Po udanej analizie wysyłany jest e-mail plain text. Niezaufany HTML z forum nie jest renderowany.

Odbiorca pochodzi wyłącznie z repository variable `HRM_NOTIFY_EMAIL`. Treść wpisu nie może zmienić odbiorcy, hosta SMTP, modelu ani uprawnień.

E-mail zawiera target publikacji. Dla komentarza jest to GitHub GraphQL node ID, który pozwala zachować kontekst. Dla Discussion można też użyć jego numeru albo pełnego URL.

## Manual approval

Ręczne uruchomienie `HRM Publish Approved Reply` jest aktem zatwierdzenia. Workflow wymaga:

1. `target` — numer/URL Discussion albo node ID z e-maila;
2. `approved_polish_reply` — pełny tekst zatwierdzony lub poprawiony po polsku;
3. `confirmation` — dokładnie `PUBLISH`.

Jeżeli potwierdzenie nie jest dokładnie `PUBLISH`, workflow kończy się bez odczytu targetu, bez OpenAI i bez publikacji.

## Publishing approved replies

Workflow `.github/workflows/hrm-publish-approved-reply.yml` ma wyłącznie trigger `workflow_dispatch` oraz:

```yaml
permissions:
  contents: read
  discussions: write
```

Po zatwierdzeniu:

1. target jest sprawdzany składniowo;
2. GitHub GraphQL potwierdza, że należy on do tego repozytorium;
3. język jest ustalany z właściwego wpisu;
4. dla polskiego wpisu publikowany jest dokładnie zatwierdzony tekst, bez OpenAI;
5. dla innego języka wykonywane jest najwyżej jedno tłumaczenie;
6. tłumaczenie niespełniające progów pewności i wierności jest odrzucane;
7. dopiero oficjalna mutacja `addDiscussionComment` publikuje komentarz.

Model jest wyłącznie tłumaczem. Nie może dodawać, usuwać, łagodzić, zaostrzać ani poprawiać merytorycznie zatwierdzonego tekstu.

Implementacja korzysta z oficjalnego [GitHub Discussions GraphQL API](https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions).

## Required GitHub Secrets

W **Settings → Secrets and variables → Actions → Secrets** dodaj:

- `OPENAI_API_KEY` — istniejący klucz OpenAI API;
- `SMTP_HOST` — sama nazwa hosta poczty wychodzącej, bez `https://`, portu i ścieżki;
- `SMTP_PORT` — port SMTP podany przez operatora skrzynki;
- `SMTP_USERNAME` — login dokładnie z ustawień skrzynki;
- `SMTP_PASSWORD` — hasło skrzynki albo hasło aplikacyjne wymagane przez operatora;
- `SMTP_FROM` — zatwierdzony nadawca, np. `HRM Forum <adres-skrzynki@example.com>`.

Sekrety nie są zapisywane w repozytorium, e-mailu, artefakcie ani Job Summary. Dane SMTP nie są wysyłane do OpenAI.

## Required Repository Variables

W **Settings → Secrets and variables → Actions → Variables** ustaw:

- `OPENAI_MODEL` — obecnie `gpt-5.4-nano`;
- `HRM_NOTIFY_EMAIL` — docelowo `manifest@hrm.se`.

Opcjonalne:

- `OPENAI_TRANSLATION_MODEL` — osobny model tłumaczący; bez niego używany jest `OPENAI_MODEL`;
- `HRM_EMAIL_ENABLED` — `true` lub `false`; brak wartości oznacza `true`.

## SMTP configuration — krok po kroku

Nie zgaduj hosta ani portu. Odczytaj je z panelu operatora skrzynki, instrukcji konfiguracji klienta pocztowego albo uzyskaj od pomocy technicznej Loopia.

1. Otwórz ustawienia konkretnej skrzynki używanej jako nadawca.
2. Znajdź sekcję „poczta wychodząca”, „SMTP” albo instrukcję konfiguracji programu pocztowego.
3. Skopiuj nazwę serwera wychodzącego do `SMTP_HOST`.
4. Skopiuj port do `SMTP_PORT`.
5. Sprawdź szyfrowanie: port `465` jest obsługiwany jako bezpośrednie TLS, a na innym porcie kod wymaga STARTTLS. Połączenie bez TLS jest odrzucane.
6. Skopiuj login do `SMTP_USERNAME`. Nie zakładaj, że jest nim adres e-mail, dopóki instrukcja tego nie potwierdzi.
7. Użyj wskazanego hasła lub hasła aplikacyjnego jako `SMTP_PASSWORD`.
8. Ustaw `SMTP_FROM` na adres, z którego skrzynka ma prawo wysyłać.
9. Ustaw odbiorcę jako `HRM_NOTIFY_EMAIL` w Variables.
10. Nie wklejaj tych wartości do Discussion, logów, repozytorium ani zgłoszeń pomocy.

`nodemailer` jest przypięty do dokładnej wersji w `package.json` i `package-lock.json`. Połączenia wymagają TLS 1.2 lub nowszego oraz poprawnego certyfikatu.

## Pierwszy test e-mail

Po przyszłym wdrożeniu:

1. dodaj wszystkie sekrety i zmienne;
2. otwórz **Actions → HRM Forum Steward v2 → Run workflow**;
3. użyj nieszkodliwego pytania testowego bez danych prywatnych;
4. nie uruchamiaj workflow publikującego;
5. sprawdź e-mail: oryginał, tłumaczenie, polską propozycję i target;
6. sprawdź Job Summary — ma potwierdzić e-mail i brak publikacji;
7. przy błędzie ponownie porównaj ustawienia skrzynki, ale nie drukuj sekretów.

## Pierwszy test ręcznej publikacji

Ten test tworzy publiczny komentarz. Wykonaj go wyłącznie w specjalnej Discussion testowej.

1. Utwórz ręcznie Discussion przeznaczoną do testu.
2. Skopiuj jej numer lub URL.
3. Otwórz **Actions → HRM Publish Approved Reply → Run workflow**.
4. Wklej target i krótki, jawnie testowy tekst polski.
5. Najpierw uruchom z potwierdzeniem innym niż `PUBLISH` i sprawdź `PUBLISHED: NO`.
6. Dopiero po weryfikacji targetu uruchom ponownie z dokładnym `PUBLISH`.
7. Sprawdź URL komentarza w Job Summary.
8. Nie testuj na aktywnej rozmowie użytkownika.

## Security model

- Forum jest niezaufanym wejściem i nigdy nie steruje powłoką.
- Prompt injection jest ignorowany podczas analizy i tłumaczenia.
- Analiza nie ma prawa zapisu do Discussions.
- Publikacja nie ma triggera automatycznego.
- Target musi należeć do `GITHUB_REPOSITORY`.
- E-mail jest plain text, a Job Summary neutralizuje Markdown i HTML.
- Nie ma funkcji usuwania, zamykania, blokowania, zmiany kategorii ani edycji HRM.
- GitHub Actions są przypięte do pełnych SHA.
- OpenAI Responses API używa Structured Outputs oraz `store: false`, zgodnie z [OpenAI API Reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

Limity: wpis 8 000 znaków, źródła 12 000 znaków i 6 fragmentów, zatwierdzona odpowiedź 8 000 znaków, najwyżej jedno OpenAI dla analizy i jedno dla niepolskiego publikowania, zero OpenAI przy publikowaniu do polskiego wpisu, job 5 minut.

## How to disable analysis

Otwórz **Actions → HRM Forum Steward v2**, wybierz menu i kliknij **Disable workflow**.

## How to disable email

Ustaw repository variable `HRM_EMAIL_ENABLED` na `false`. Analiza pozostanie aktywna, ale SMTP nie będzie używany.

## How to disable publishing

Otwórz **Actions → HRM Publish Approved Reply**, wybierz menu i kliknij **Disable workflow**. Wyłączenie analizy nie wyłącza publikowania ręcznego.

## Emergency stop

1. Wyłącz oba workflow w Actions.
2. W **Settings → Actions → General** możesz wyłączyć wszystkie Actions.
3. Przy podejrzeniu ujawnienia zmień `OPENAI_API_KEY` i `SMTP_PASSWORD` u dostawców, a następnie zaktualizuj GitHub Secrets.
4. Ustaw `HRM_EMAIL_ENABLED=false`.
5. Nie usuwaj wpisów forum automatycznie; najpierw wykonaj ręczny audyt.

## Local tests

Testy nie wysyłają prawdziwych e-maili i nie publikują na forum:

```bash
cd forum-steward
npm ci
npm test
npm audit
```
