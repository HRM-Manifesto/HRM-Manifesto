# HRM Forum Steward v2.1 — Email Approval

HRM Forum Steward v2.1 pomaga Aleksandrowi bezpiecznie obsługiwać GitHub Discussions. Analiza, zatwierdzenie e-mail i publikacja są rozdzielone. Istniejący ręczny workflow publikacyjny pozostaje jako awaryjny fallback.

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

Po udanej analizie wysyłany jest e-mail w bezpiecznej wersji tekstowej i prostej wersji HTML. Wszystkie fragmenty pochodzące z forum są kodowane; niezaufany HTML nie jest renderowany.

Odbiorca pochodzi wyłącznie z repository variable `HRM_NOTIFY_EMAIL`. Treść wpisu nie może zmienić odbiorcy, hosta SMTP, modelu ani uprawnień.

Każdy e-mail otrzymuje kryptograficznie losowy, jednorazowy Approval ID o entropii 256 bitów. Pełne ID jest obecne wyłącznie w prywatnym e-mailu i podpisanym rekordzie IMAP. Job Summary, artefakt i komentarz GitHub nie pokazują pełnego ID.

Rekord oczekującej sprawy jest podpisany HMAC przy użyciu sekretu `HRM_APPROVAL_SECRET`. Zawiera repozytorium, oryginalny target, dokładną polską propozycję oraz datę wygaśnięcia. Dzięki temu treść decyzji e-mail nie może podmienić targetu, repozytorium ani odpowiedzi zapisanej przez Stewarda.

## Obsługa dla Aleksandra

1. Dostajesz e-mail z tematem `[HRM Forum] Review required — ...`.
2. Czytasz oryginał, pełne tłumaczenie i propozycję po polsku.
3. Wybierasz jedną decyzję:
   - klikasz **ZATWIERDŹ**, a następnie naciskasz **Wyślij** w przygotowanej wiadomości;
   - klikasz **NIE ODPOWIADAJ**, a następnie naciskasz **Wyślij**;
   - tworzysz wiadomość `HRM EDIT ...` i umieszczasz poprawioną odpowiedź między znacznikami.
4. Samo kliknięcie linku `mailto:` niczego nie publikuje.
5. Procesor IMAP wykonuje resztę po otrzymaniu prawidłowej wiadomości.

Dokładne komendy są deterministyczne: `ZATWIERDZAM`, `NIE ODPOWIADAJ` albo `POPRAWIAM` z blokiem `---ODPOWIEDŹ---` / `---KONIEC---`. Model nigdy nie decyduje, czy wiadomość jest zgodą.

## HRM Email Approval Processor

Workflow `.github/workflows/hrm-email-approval.yml` uruchamia się ręcznie albo co 5 minut. Łączy się z IMAP przez bezpośrednie SSL/TLS, odczytuje wyłącznie kandydatów HRM z ostatnich 15 dni i przyjmuje decyzję tylko wtedy, gdy jednocześnie:

- Approval ID ma prawidłowy format;
- istnieje podpisany rekord oczekującej sprawy;
- podpis HMAC jest prawidłowy;
- rekord dotyczy tego repozytorium;
- ID nie wygasło (domyślnie 14 dni);
- `From` jest dokładnie zgodny z `HRM_NOTIFY_EMAIL`;
- komenda ma dokładny dozwolony format.

Po przetworzeniu wiadomości są przenoszone do folderów HRM: `Processed`, `Rejected`, `Invalid` albo `Failed`. Procesor pobiera separator hierarchii zgłoszony przez serwer IMAP, więc nie zakłada na sztywno `/`. Tworzenie jest idempotentne. Jeżeli serwer nie obsługuje folderów zagnieżdżonych, używane są bezpieczne nazwy płaskie: `HRM-Processed`, `HRM-Rejected`, `HRM-Failed` i `HRM-Invalid`. Sprawy z folderu `Failed` nie są automatycznie ponawiane co 5 minut; wymagają ręcznego sprawdzenia i ewentualnie awaryjnego workflow.

Przed publikacją procesor sprawdza nieodwracalny marker SHA-256 Approval ID w komentarzach Discussion. Chroni to przed ponowną publikacją po restarcie lub błędzie sieciowym. Pełne Approval ID nie trafia do komentarza.

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
- `HRM_APPROVAL_SECRET` — nowy losowy sekret co najmniej 32-znakowy, używany wyłącznie do podpisywania rekordów zatwierdzeń;
- `SMTP_HOST` — sama nazwa hosta poczty wychodzącej, bez `https://`, portu i ścieżki;
- `SMTP_PORT` — port SMTP podany przez operatora skrzynki;
- `SMTP_USERNAME` — login dokładnie z ustawień skrzynki;
- `SMTP_PASSWORD` — hasło skrzynki albo hasło aplikacyjne wymagane przez operatora;
- `SMTP_FROM` — zatwierdzony nadawca, np. `HRM Forum <adres-skrzynki@example.com>`.
- `IMAP_HOST` — sama nazwa hosta IMAP, bez protokołu, portu i ścieżki;
- `IMAP_PORT` — port bezpośredniego IMAP SSL/TLS podany przez operatora;
- `IMAP_USERNAME` — login IMAP;
- `IMAP_PASSWORD` — hasło skrzynki albo hasło aplikacyjne.

Sekrety nie są zapisywane w repozytorium, e-mailu, artefakcie ani Job Summary. Dane SMTP nie są wysyłane do OpenAI.

`HRM_APPROVAL_SECRET` powinien być niezależny od haseł SMTP i IMAP. Wygeneruj go lokalnie poleceniem:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Skopiuj wynik bezpośrednio do GitHub Secret i usuń go z historii schowka/terminala, jeśli używane narzędzie ją zapisuje. Zmiana tego sekretu unieważni wszystkie oczekujące zatwierdzenia.

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

`nodemailer` `9.0.6`, `imapflow` `1.7.6` i `mailparser` `3.9.17` są przypięte do dokładnych wersji w `package.json` i `package-lock.json`. Połączenia wymagają TLS 1.2 lub nowszego oraz poprawnego certyfikatu.

## IMAP configuration — krok po kroku

Nie zgaduj parametrów Loopia. Pobierz je z panelu konkretnej skrzynki lub instrukcji operatora.

1. Znajdź ustawienia poczty przychodzącej IMAP dla `manifest@hrm.se`.
2. Wybierz parametry bezpośredniego IMAP SSL/TLS, nie POP3.
3. Skopiuj sam host do `IMAP_HOST`.
4. Skopiuj port SSL/TLS do `IMAP_PORT`.
5. Skopiuj login do `IMAP_USERNAME`.
6. Ustaw hasło lub hasło aplikacyjne jako `IMAP_PASSWORD`.
7. Nie używaj danych SMTP jako IMAP, dopóki operator nie potwierdzi, że są takie same.
8. Procesor wymaga TLS 1.2+, poprawnego certyfikatu i nie zezwala na połączenie nieszyfrowane.

## Pierwszy test e-mail

Po przyszłym wdrożeniu:

1. dodaj wszystkie sekrety i zmienne;
2. otwórz **Actions → HRM Forum Steward v2 → Run workflow**;
3. użyj nieszkodliwego pytania testowego bez danych prywatnych;
4. nie uruchamiaj workflow publikującego;
5. sprawdź e-mail: oryginał, tłumaczenie, polską propozycję i target;
6. sprawdź Job Summary — ma potwierdzić e-mail i brak publikacji;
7. przy błędzie ponownie porównaj ustawienia skrzynki, ale nie drukuj sekretów.

## Pierwszy bezpieczny test zatwierdzenia e-mail

1. Pozostaw `HRM_EMAIL_ENABLED=false`, dopóki wszystkie nowe sekrety IMAP i `HRM_APPROVAL_SECRET` nie są gotowe.
2. Utwórz osobną, jawną Discussion testową.
3. Ustaw `HRM_EMAIL_ENABLED=true` i uruchom ręczny test analizy dla tej Discussion albo dodaj testowy wpis.
4. Sprawdź, że e-mail zawiera właściwy link, target i polską propozycję.
5. Najpierw wybierz **NIE ODPOWIADAJ**, wyślij przygotowaną wiadomość i ręcznie uruchom `HRM Email Approval Processor`.
6. Potwierdź brak komentarza oraz przeniesienie sprawy do `HRM/Rejected`.
7. Utwórz drugą Discussion testową i powtórz analizę.
8. Kliknij **ZATWIERDŹ**, ale przed wysłaniem jeszcze raz sprawdź temat i treść. Dopiero potem naciśnij **Wyślij**.
9. Ręcznie uruchom procesor i sprawdź e-mail potwierdzający oraz link do jednego opublikowanego komentarza.
10. Ponownie wyślij tę samą decyzję i potwierdź, że drugi komentarz nie powstał.

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
- From sam w sobie nie jest autoryzacją; wymagane są także tajne Approval ID i prawidłowy podpis rekordu.
- Decyzje są parsowane deterministycznie bez użycia modelu.
- Approval ID wygasa po 14 dniach i jest jednorazowe.
- Podpisany rekord, a nie tekst decyzji, ustala target i zapisaną propozycję.
- E-mail jest plain text, a Job Summary neutralizuje Markdown i HTML.
- Nie ma funkcji usuwania, zamykania, blokowania, zmiany kategorii ani edycji HRM.
- GitHub Actions są przypięte do pełnych SHA.
- OpenAI Responses API używa Structured Outputs oraz `store: false`, zgodnie z [OpenAI API Reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

Limity: wpis 8 000 znaków, źródła 12 000 znaków i 6 fragmentów, zatwierdzona odpowiedź 8 000 znaków, wiadomość IMAP 256 000 bajtów, najwyżej jedno OpenAI dla analizy i jedno dla niepolskiego publikowania, zero OpenAI przy publikowaniu do polskiego wpisu.

## How to disable analysis

Otwórz **Actions → HRM Forum Steward v2**, wybierz menu i kliknij **Disable workflow**.

## How to disable email

Ustaw repository variable `HRM_EMAIL_ENABLED` na `false`. Analiza pozostanie aktywna, ale SMTP nie będzie używany.

## How to disable publishing

Otwórz **Actions → HRM Publish Approved Reply**, wybierz menu i kliknij **Disable workflow**. Wyłączenie analizy nie wyłącza publikowania ręcznego.

## How to stop the email processor

Otwórz **Actions → HRM Email Approval Processor**, wybierz menu i kliknij **Disable workflow**. Zatrzymuje to harmonogram i ręczne przetwarzanie IMAP, ale nie usuwa oczekujących wiadomości. Awaryjny `HRM Publish Approved Reply` pozostaje dostępny osobno.

## Troubleshooting

- **Brak e-maila analizy:** sprawdź `HRM_EMAIL_ENABLED`, SMTP Secrets i Job Summary. Nie drukuj wartości sekretów.
- **Procesor nie łączy się:** Job Summary pokazuje wyłącznie bezpieczną kategorię (`CONFIG`, `DNS_CONNECT`, `TLS`, `AUTH`, `FOLDER_CREATE`, `INBOX_LOCK`, `SEARCH`, `FETCH`, `MOVE`, `LOGOUT` albo `UNKNOWN`), kod protokołu i etap. Nie pokazuje hosta, loginu, hasła, Approval ID ani treści wiadomości.
- **CONFIG:** sprawdź, czy wszystkie wymagane wartości istnieją i czy port jest liczbą.
- **DNS_CONNECT / TLS / AUTH:** porównaj ustawienia z oficjalną instrukcją IMAP operatora; nie używaj POP3 ani parametrów SMTP bez potwierdzenia.
- **FOLDER_CREATE:** sprawdź uprawnienie skrzynki do tworzenia folderów. Procesor sam obsługuje istniejące foldery, delimiter serwera i tryb płaski.
- **Decyzja jest nieprawidłowa:** sprawdź dokładny temat, pełne Approval ID, adres From i dokładną treść komendy.
- **Approval wygasł:** wykonaj nową analizę, aby otrzymać nowe powiadomienie.
- **Publikacja nie nastąpiła:** sprawdź Job Summary procesora. Przy błędzie GitHub lub tłumaczenia wiadomości pozostają nieoznaczone jako successful.
- **E-mail potwierdzający nie dotarł:** publikacja może już istnieć; sprawdź Discussion i Job Summary przed ponowną próbą.
- **Awaryjna publikacja:** użyj istniejącego `HRM Publish Approved Reply` dopiero po ręcznej weryfikacji targetu i polskiej treści.

## Emergency stop

1. Wyłącz trzy workflow w Actions: analizę, procesor e-mail i awaryjną publikację.
2. W **Settings → Actions → General** możesz wyłączyć wszystkie Actions.
3. Przy podejrzeniu ujawnienia zmień odpowiednie hasła, `OPENAI_API_KEY` i `HRM_APPROVAL_SECRET`, a następnie zaktualizuj GitHub Secrets.
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
