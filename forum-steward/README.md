# HRM Forum Steward v2.2 — Simple Approval + Quiet Mailbox

## NORMALNA OBSŁUGA ALEKSANDRA

1. Dostajesz jeden krótki mail.
2. Czytasz wpis po polsku.
3. Czytasz proponowaną odpowiedź po polsku.
4. Wybierasz:
   - **Zatwierdź i opublikuj**;
   - **Popraw**;
   - **Nie odpowiadaj**.
5. Resztę robi system.

Nie trzeba kopiować URL, pisać `PUBLISH`, otwierać GitHub Actions ani wysyłać maila `ZATWIERDZAM`.

Ten prosty tryb wymaga wdrożonego i skonfigurowanego Approval Gateway. Komponent gateway jest przygotowany do audytu, ale **nie jest wdrażany przez to repozytorium**. Dopóki gateway nie zostanie osobno wdrożony, podpisany mechanizm e-mail/IMAP v2.1 oraz ręczny workflow publikacyjny pozostają awaryjnym fallbackiem.

## Co robi Steward

Workflow `HRM Forum Steward v2.2` reaguje na nową Discussion lub komentarz, analizuje wyłącznie nowy wpis, korzysta tylko z oficjalnych materiałów HRM w repozytorium i przygotowuje polską wersję roboczą. Analiza nadal trafia do Job Summary i artefaktu, ale zwykły e-mail zawiera tylko informacje potrzebne do decyzji.

E-mail nie jest wysyłany dla spamu, testu, śmieci, własnego komentarza automatyzacji ani sprawy, która nie wymaga odpowiedzi. Brak propozycji przy `requiresAleksander=false` i niskiej ważności oznacza zero maili. Jeżeli nie ma propozycji, ale potrzebna jest osobista decyzja Aleksandra albo sprawa jest ważna, wysyłany jest krótki mail z opcjami **Napisz odpowiedź** i **Nie odpowiadaj** — bez przycisku zatwierdzenia.

## Mobile first

Mail ma jedną kolumnę, bazowy font 16 px, nagłówki 18–22 px, przyciski o wysokości co najmniej 52 px i maksymalną szerokość 640 px. Nie używa szerokich tabel ani interakcji zależnych od hover.

Wpis niepolski jest pokazywany przede wszystkim jako pełne polskie tłumaczenie. Oryginał pozostaje pod linkiem do GitHuba. Wpis polski nie jest duplikowany jako tłumaczenie. Długi wpis jest ograniczany do czytelnego fragmentu i streszczenia. Długa propozycja nie może zostać zatwierdzona bez zobaczenia pełnej treści — przycisk prowadzi najpierw na pełny ekran zatwierdzenia.

Podstawa HRM ma najwyżej trzy krótkie nazwy sekcji. Ścieżki plików, Node ID, Approval ID, workflowy, API, dane SMTP/IMAP i informacje diagnostyczne nie są widoczne w normalnej treści e-maila. Podpisany rekord pozostaje w niewidocznym nagłówku technicznym wiadomości, aby zachować fallback IMAP.

Fixture sześciu wymaganych przypadków znajduje się w `fixtures/review-email-fixtures.mjs`. Lokalny renderer `fixtures/render-review-email.mjs` służy wyłącznie do audytu wyglądu i nie wysyła wiadomości.

## Dlaczego bezpieczne zatwierdzenie wymaga dwóch tapnięć

Bezpośrednie `GET /approve?...` wykonujące publikację jest zabronione. Klient pocztowy, filtr antyspamowy lub generator podglądu może otworzyć taki link automatycznie.

Bezpieczny wariant to:

1. tapnięcie przycisku w e-mailu i otwarcie mobilnej strony;
2. świadome naciśnięcie dużego przycisku formularza wysyłającego `POST`.

`GET`, `HEAD` i prefetch nigdy nie zmieniają trwałego stanu. Formularz `POST` wymaga tego samego originu oraz krótkotrwałego tokenu CSRF związanego z akcją i tokenem sprawy. To są dwa tapnięcia, ale bez pisania, kopiowania, odpowiadania e-mailem i otwierania Actions.

## Approval Gateway — przygotowany, niewdrożony

Kod audytowalnej maszyny stanów znajduje się w `src/approval-gateway.mjs`, a kontrakt trwałej bazy i schemat w `approval-gateway/`.

- losowy token ma 256 bitów entropii, nie jest Approval ID i w bazie występuje tylko jako SHA-256;
- token wygasa razem z podpisanym rekordem, domyślnie po 14 dniach;
- `notification_key` ma unikalny indeks i blokuje drugi mail dla tego samego eventu;
- decyzja jest atomowo przejmowana przed publikacją;
- replay, token wygasły i token wykorzystany są odrzucane;
- błąd gateway lub GitHuba zużywa sprawę jako `failed` i nie uruchamia automatycznej ponownej publikacji;
- `EDIT` przekazuje dokładny polski tekst Aleksandra; model może go jedynie wiernie przetłumaczyć;
- `REJECT` nie wywołuje OpenAI ani GitHuba.

`MemoryGatewayStore` jest wyłącznie implementacją testową. Produkcja musi używać transakcyjnego adaptera bazy zgodnego z `approval-gateway/schema.sql`. Gateway nie może być uruchomiony publicznie z magazynem w pamięci.

### Hosting Loopia

Publiczne `hrm.se` odpowiada obecnie z infrastruktury Loopia. Oficjalna dokumentacja Loopia opisuje PHP i MariaDB/MySQL na hostingu UNIX, ale stwierdza, że Node.js działa dopiero na VPS:

- [PHP na hostingu Loopia](https://support.loopia.se/wiki/vilken-version-av-php-kor-ni/)
- [Node.js wymaga VPS](https://support.loopia.se/wiki/fungerar-node-js-pa-loopia/)
- [MySQL/MariaDB](https://support.loopia.se/wiki/mysql-administration/)

Repozytorium nie pozwala ustalić pakietu konta, aktywnego PHP ani dostępności bazy. Dlatego gateway nie zakłada runtime i nie jest wdrażany. Przed wdrożeniem należy wybrać jedno z dwóch rozwiązań po osobnym audycie:

1. mały port PHP + MariaDB na hostingu UNIX, jeśli panel potwierdzi te funkcje;
2. obecna implementacja Node na osobnym Loopia VPS z transakcyjną bazą.

W obu przypadkach gateway powinien działać na osobnej domenie HTTPS, np. `approve.hrm.se`, bez zmian publicznej zawartości `www.hrm.se`.

## Quiet mailbox

Domyślna i produkcyjna wartość `HRM_CONFIRMATION_EMAILS` to `false`. Po zatwierdzeniu, poprawieniu, odrzuceniu, duplikacie lub udanej publikacji nie jest wysyłany kolejny e-mail. Wynik jest pokazywany tylko na stronie mobilnej i w GitHub Actions.

Normalny scenariusz:

`wpis → 1 mail decyzyjny → POST zatwierdzenia → publikacja`

**Łączna liczba maili dla człowieka: 1.**

Opcjonalny tryb diagnostyczny `HRM_CONFIRMATION_EMAILS=true` zachowuje dawne potwierdzenia, ale nie powinien być włączony produkcyjnie.

## Automatyczny procesor i fallback v2.1

`HRM Email Approval Processor` nadal uruchamia się automatycznie co 5 minut. `workflow_dispatch` pozostaje wyłącznie narzędziem awaryjnym. Procesor zachowuje:

- podpisane rekordy HMAC;
- deterministyczny parser `APPROVE`, `EDIT`, `REJECT`;
- kontrolę nadawcy;
- 14-dniową ważność;
- ochronę przed replay;
- bezpieczne foldery IMAP i diagnostykę;
- marker publikacji zabezpieczający przed duplikatem.

Nowy e-mail przechowuje rekord w nagłówku `X-HRM-Approval-Record`; procesor nadal czyta również stare rekordy v1/v2 umieszczone w treści dawnych wiadomości.

Awaryjny `HRM Publish Approved Reply` nadal wymaga ręcznego `workflow_dispatch`, pełnego polskiego tekstu i dokładnego `PUBLISH`.

## Konfiguracja GitHub

### Istniejące Secrets

- `OPENAI_API_KEY`
- `HRM_APPROVAL_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`
- `IMAP_HOST`, `IMAP_PORT`, `IMAP_USERNAME`, `IMAP_PASSWORD`

### Istniejące Variables

- `OPENAI_MODEL`
- opcjonalnie `OPENAI_TRANSLATION_MODEL`
- `HRM_NOTIFY_EMAIL`
- `HRM_EMAIL_ENABLED`

### Nowe ustawienia wymagane dopiero do aktywacji gateway

- GitHub Secret `HRM_GATEWAY_SHARED_SECRET` — niezależny losowy sekret co najmniej 32-znakowy;
- repository variable `HRM_APPROVAL_GATEWAY_URL` — czysty origin HTTPS, np. `https://approve.hrm.se`;
- opcjonalna variable `HRM_AUTOMATION_LOGIN` — domyślnie `github-actions[bot]`;
- opcjonalna variable `HRM_CONFIRMATION_EMAILS` — pozostawić `false`.

Gateway poza GitHub Actions będzie potrzebował własnych, niecommitowanych wartości:

- tego samego `HRM_APPROVAL_SECRET` do kontroli podpisu;
- tego samego `HRM_GATEWAY_SHARED_SECRET` do uwierzytelnienia rejestracji;
- niezależnego `HRM_GATEWAY_CSRF_SECRET`;
- poświadczeń transakcyjnej bazy danych;
- repozytoryjnego GitHub App lub wąsko ograniczonego tokenu z prawem zapisu tylko do Discussions;
- `OPENAI_API_KEY` i modelu wyłącznie do wiernego tłumaczenia zatwierdzonego tekstu.

Nie ustawiaj URL ani sekretu gateway, dopóki backend, baza, TLS, kopie zapasowe, limity ruchu i logowanie bez danych wrażliwych nie przejdą osobnego audytu stagingowego.

## Permissions

Analiza pozostaje read-only:

```yaml
permissions:
  contents: read
  discussions: read
```

Procesor IMAP i awaryjny publisher zachowują tylko:

```yaml
permissions:
  contents: read
  discussions: write
```

Nie dodano `contents: write`, `issues: write`, `pull-requests: write` ani `actions: write`. Przyszły gateway ma otrzymać zapis do Discussions wyłącznie w swoim komponencie publikującym.

## Granice bezpieczeństwa

- Forum jest niezaufanym wejściem i nie steruje kodem ani konfiguracją.
- OpenAI Responses API używa `store: false` i Structured Outputs.
- Stanowisko HRM pochodzi wyłącznie z oficjalnych materiałów repozytorium.
- Analiza i tworzenie e-maila nie mają prawa publikacji.
- Approval ID, token gateway i sekrety nie trafiają do OpenAI ani publicznych logów.
- Zmiana stanu gateway wymaga `POST`; `GET`, `HEAD` i prefetch są pasywne.
- Token gateway jest jednorazowy i odrębny od Approval ID.
- Dla polskiego celu publikowany jest dokładny zatwierdzony tekst bez OpenAI.
- Dla innego języka jest najwyżej jedno wywołanie tłumaczące, które nie może zmienić sensu.
- Nie ma funkcji usuwania wpisów, blokowania użytkowników, zamykania dyskusji ani edycji HRM 1.0.

Limity pozostają: wpis 8 000 znaków, źródła 12 000 znaków i 6 fragmentów, zatwierdzona odpowiedź 8 000 znaków, wiadomość IMAP 256 000 bajtów. E-mail pokazuje najwyżej 1 200 znaków wpisu i 1 800 znaków propozycji.

## Wyłączenie

- Analiza: wyłącz workflow `HRM Forum Steward v2.2` w GitHub Actions.
- E-mail: ustaw `HRM_EMAIL_ENABLED=false`.
- Gateway: usuń lub wyczyść `HRM_APPROVAL_GATEWAY_URL`; wtedy kod nie łączy się z gateway.
- Procesor: wyłącz `HRM Email Approval Processor`.
- Publikacja awaryjna: wyłącz `HRM Publish Approved Reply`.

## Testy lokalne

Testy używają wyłącznie atrap SMTP, IMAP, GitHub, OpenAI i gateway. Nie wysyłają prawdziwych wiadomości i niczego nie publikują.

```bash
cd forum-steward
npm ci
npm test
npm audit --omit=dev
```
