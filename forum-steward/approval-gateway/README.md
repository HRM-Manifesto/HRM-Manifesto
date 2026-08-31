# HRM Approval Gateway — produkcyjny pakiet PHP, jeszcze niewdrożony

Ten katalog zawiera przygotowany do wdrożenia wariant `PHP 8.x + MariaDB/MySQL` dla `https://approve.hrm.se/`. Nic w tym katalogu nie zmienia DNS, hostingu, sekretów ani publicznej strony HRM.

## Wybrana architektura

Zalecany jest zwykły hosting UNIX Loopia z PHP i MariaDB/MySQL. Loopia udostępnia te elementy na hostingu współdzielonym, certyfikaty Let's Encrypt i kopie zapasowe. Node.js wymaga osobnego VPS, a więc również administracji systemem, aktualizacji systemowych, procesu aplikacji, reverse proxy i osobnej polityki backupu. Gateway jest mały i działa żądanie-po-żądaniu, dlatego VPS nie daje tu uzasadnionej korzyści.

| Obszar | PHP + MariaDB na Loopia | Node.js na Loopia VPS |
|---|---|---|
| Prostota | istniejący panel, PHP, baza i HTTPS | osobny serwer i stały proces |
| Utrzymanie | aktualizacje platformy po stronie hostingu | aktualizacje systemu, Node, proxy i usług po stronie HRM |
| Koszt | w ramach zgodnego pakietu hostingowego | dodatkowy VPS |
| Backup | mechanizmy hostingu plus eksport bazy | trzeba zaprojektować i kontrolować osobno |
| Sekrety | plik poza katalogiem publicznym | menedżer usług/zmienne systemowe |
| Niezawodność | brak procesu rezydentnego | konieczny monitoring procesu i restartów |

Oficjalne materiały Loopia:

- [tworzenie subdomeny](https://support.loopia.se/wiki/skapa-en-subdoman/);
- [Node.js wymaga VPS](https://support.loopia.se/wiki/fungerar-node-js-pa-loopia/);
- [tworzenie bazy MySQL/MariaDB](https://support.loopia.se/wiki/skapa-en-mysql-databas/);
- [połączenie PHP z MySQL](https://support.loopia.se/wiki/koppling-av-php-till-mysql/);
- [Let's Encrypt](https://support.loopia.se/wiki/lets-encrypt/);
- [kopie zapasowe Loopia](https://support.loopia.se/wiki/hur-ofta-gor-ni-backup/).

## Co jest gotowe

- `php/public/` — jedyny katalog wystawiany przez serwer WWW;
- `php/src/` — router, walidacja podpisanego rekordu, trwały store PDO, klient GitHub App i tłumaczenie przez OpenAI Responses API;
- `php/config.example.php` — szablon konfiguracji bez prawdziwych danych;
- `schema.sql` — minimalna tabela InnoDB;
- `php/test/run.php` — testy bez sieci, maila, OpenAI i GitHuba;
- `../src/approval-gateway.mjs` — referencyjna/testowa maszyna stanów używana przez testy integracyjne Node.

`MemoryGatewayStore` pozostaje wyłącznie atrapą testową. Produkcyjny entrypoint zawsze tworzy `PdoGatewayStore`; nie ma przełącznika uruchamiającego pamięciowy store w produkcji.

## Kontrakt bezpieczeństwa

- `GET`, `HEAD`, prefetch i preview nigdy nie zmieniają stanu.
- Decyzja wymaga formularza `POST`, zgodnego `Origin` oraz krótkotrwałego CSRF powiązanego z akcją i tokenem.
- Token capability ma 32 losowe bajty (256 bitów), jest niezależny od Approval ID i trafia do bazy wyłącznie jako SHA-256.
- Surowy token jest obecny w prywatnym linku e-mailowym, ale nie w renderowanym HTML, formularzu, OpenAI ani logach aplikacyjnych.
- `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, CSP i blokada ramek są ustawiane na każdej odpowiedzi.
- `notification_key` jest kluczem głównym. Powtórzony event nie tworzy drugiej sprawy ani drugiego maila.
- Warunkowy `UPDATE pending -> processing` atomowo wybiera jednego zwycięzcę. Replay, double click i równoległy drugi `POST` nie publikują drugi raz.
- Błąd lub niejednoznaczny wynik GitHuba/OpenAI kończy sprawę jako `failed`; nie ma automatycznej ponownej publikacji.
- Marker komentarza chroni także przed duplikatem, gdy GitHub opublikował komentarz wcześniej.
- `EDIT` przekazuje dokładnie tekst Aleksandra. Dla polskiej dyskusji nie ma wywołania OpenAI; dla innego języka model może tylko wiernie tłumaczyć.
- Responses API jest wywoływane dopiero po prawidłowym `POST` i zawsze z `store: false`.
- Gateway nie zawiera SMTP, IMAP ani maila potwierdzającego.

Nie należy podłączać analityki, zewnętrznych skryptów, CDN ani publicznego logowania pełnych URL. Prywatne logi serwera WWW mogą technicznie widzieć ścieżkę pierwszego wejścia z capability tokenem; należy ograniczyć dostęp i retencję tych logów. Kod aplikacji nie zapisuje URI, tokenów, treści, Approval ID ani sekretów.

## Wymagania hostingu

- PHP 8.2 lub nowszy;
- rozszerzenia: `curl`, `json`, `mbstring`, `openssl`, `PDO`, `pdo_mysql`;
- MariaDB/MySQL z InnoDB i `utf8mb4`;
- HTTPS oraz Apache rewrite (`.htaccess`);
- możliwość trzymania konfiguracji i klucza prywatnego poza `public_html`.

## Docelowy układ na Loopia

Przykładowy układ katalogu subdomeny (nazwy nadrzędnych katalogów zależą od panelu Loopia):

```text
approve.hrm.se/
├── public_html/        # zawartość php/public/
│   ├── .htaccess
│   └── index.php
├── src/                # zawartość php/src/, poza public_html
├── private/
│   └── hrm-gateway-app.pem
└── config.php          # kopia config.example.php z prawdziwymi wartościami
```

`index.php` zakłada właśnie taki układ: `public_html` ma katalog nadrzędny wspólny z `src`, `private` i `config.php`. Pliki `config.php` i `private/` są ignorowane przez Git.

## Baza

1. W panelu Loopia utwórz osobną bazę tylko dla gateway.
2. Utwórz osobnego użytkownika bazy.
3. Jednorazowo zaimportuj `schema.sql` kontem administracyjnym.
4. Runtime potrzebuje tylko `SELECT`, `INSERT` i `UPDATE` na tabeli `hrm_approval_cases`; nie potrzebuje `DROP`, `ALTER`, `DELETE` ani dostępu do innych baz.
5. Włącz/zweryfikuj backup bazy w panelu i wykonaj próbę odtworzenia przed aktywacją.

Baza przechowuje tylko klucz notyfikacji, hash tokenu, repozytorium i cel, polską propozycję potrzebną do decyzji, nieodwracalny hash Approval ID, status, czasy i opcjonalny URL wyniku. Nie przechowuje surowego tokenu, Approval ID, podpisanego rekordu ani sekretów.

## GitHub App — minimalne uprawnienia

Utwórz osobną GitHub App bez webhooków i zainstaluj ją wyłącznie w `HRM-Manifesto/HRM-Manifesto`.

Repository permissions:

- **Discussions: Read and write** — odczyt celu/markera i publikacja zatwierdzonego komentarza;
- **Metadata: Read-only** — GitHub przyznaje to minimalne uprawnienie automatycznie;
- wszystkie pozostałe repository, organization i account permissions: **No access**.

W szczególności nie nadawaj `Contents write`, `Issues write`, `Pull requests write` ani `Actions write`. Gateway tworzy krótkotrwały installation access token ograniczony w żądaniu do jednego repozytorium i `discussions: write`.

## Konfiguracja bez commitowania sekretów

Po stronie GitHub repozytorium:

- Secret `HRM_GATEWAY_SHARED_SECRET` — niezależny losowy sekret co najmniej 32 znaki;
- istniejący Secret `HRM_APPROVAL_SECRET`;
- Variable `HRM_APPROVAL_GATEWAY_URL=https://approve.hrm.se` dopiero po pełnym wdrożeniu i teście stagingowym.

Po stronie `config.php` na Loopia:

- te same `approval_secret` i `gateway_shared_secret`;
- nowy, niezależny `csrf_secret`;
- osobne dane użytkownika bazy;
- GitHub App ID, Installation ID i ścieżka do prywatnego klucza PEM;
- istniejący `OPENAI_API_KEY` i konfigurowalny model tłumaczenia.

Nie kopiuj sekretów do README, zgłoszeń, logów ani poleceń widocznych w historii. Plik konfiguracyjny i PEM muszą pozostać poza `public_html` i nie mogą być częścią repozytorium.

## Ręczne kroki Aleksandra w panelach

1. W Loopia sprawdzić, że pakiet ma hosting UNIX, PHP 8.2+ i bazę MariaDB/MySQL.
2. Utworzyć subdomenę `approve.hrm.se`, wybrać hosting UNIX/PHP i włączyć certyfikat Let's Encrypt.
3. Utworzyć bazę, użytkownika oraz zaimportować `schema.sql`.
4. Wgrać pliki według układu powyżej, utworzyć niecommitowany `config.php` i ustawić prawa odczytu tylko dla właściciela/usługi WWW w zakresie wspieranym przez hosting.
5. Utworzyć GitHub App z dokładnie opisanymi uprawnieniami, zainstalować tylko w jednym repozytorium i umieścić pobrany PEM poza `public_html`.
6. Wykonać test stagingowy: GET/HEAD/skaner bez mutacji, approve/edit/reject, replay, błąd GitHuba i błąd OpenAI — bez komentarza produkcyjnego.
7. Dopiero po udanym audycie ustawić repozytoryjne `HRM_GATEWAY_SHARED_SECRET` i `HRM_APPROVAL_GATEWAY_URL`.

Kod, testy i schemat można przygotować automatycznie. Utworzenie subdomeny, certyfikatu, bazy, użytkownika, GitHub App, klucza prywatnego oraz wpisanie sekretów wymaga ręcznej czynności właściciela konta.

## Test lokalny

```powershell
php -l php/public/index.php
php php/test/run.php
```

Pełny test projektu nadal uruchamia się z katalogu `forum-steward` przez `npm test` i `npm audit --omit=dev`. Testy korzystają wyłącznie z atrap i niczego nie publikują ani nie wysyłają.
