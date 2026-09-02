<?php
declare(strict_types=1);

use Hrm\Gateway\BoardAdminGateway;
use Hrm\Gateway\BoardAdminStore;
use Hrm\Gateway\BoardCallback;
use Hrm\Gateway\Request;

$root = dirname(__DIR__);
foreach (['Http.php', 'ApprovalRecord.php', 'BoardGateway.php', 'BoardAdmin.php'] as $source) require_once $root . '/src/' . $source;

final class AdminMemoryStore implements BoardAdminStore
{
    public array $operations = [];
    public function loginAllowed(string $subjectHash, int $windowStart): bool { return true; }
    public function counts(): array { return ['new'=>1,'thinking'=>0,'published'=>0,'rejected'=>0,'all'=>1]; }
    public function identities(): array { return ['<Agent Test>']; }
    public function search(array $filters, int $page, int $limit): array
    {
        return ['total'=>1,'pages'=>1,'items'=>[['notification_key'=>str_repeat('a',64),'core_status'=>'pending','created_at'=>'2026-09-02 05:00:00','decided_at'=>null,'result_url'=>null,'moderation_status'=>'new','is_read'=>0,'is_important'=>0,'private_note'=>'','history'=>[],'submission'=>['id'=>'11111111-1111-4111-8111-111111111111','declared_identity'=>'<Agent Test>','verification_status'=>'unverified','kind'=>'question','content'=>'<script>alert(1)</script> Czy HRM słucha AI?','created_at'=>1788325200,'ai_assessment'=>['recommendation'=>'consider','reasoning'=>'Warto zachować do namysłu.']]]]];
    }
    public function setThinking(string $key): bool { $this->operations[]=['thinking',$key]; return true; }
    public function updateMeta(string $key,string $operation,string $value=''): bool { $this->operations[]=[$operation,$key,$value]; return true; }
    public function claimDecision(string $key): array { return ['kind'=>'unavailable']; }
    public function completeDecision(string $key,string $from,string $status,?string $url,array $submission,string $decision): void {}
    public function failDecision(string $key,string $from): void {}
}

final class AdminFakeCallback implements BoardCallback
{
    public function decide(string $submissionId,string $decision,int $now): array { return ['updated'=>true,'status'=>$decision==='approve'?'published':'rejected']; }
}

function adminCheck(bool $condition,string $name):void { if(!$condition) throw new RuntimeException("FAILED: $name"); echo "PASS $name\n"; }
function headerValue(array $headers,string $name):string { foreach($headers as $key=>$value) if(strcasecmp($key,$name)===0) return (string)(array_values((array)$value)[0]??''); return ''; }

$store=new AdminMemoryStore();$now=1788325200;
$gateway=new BoardAdminGateway($store,new AdminFakeCallback(),password_hash('bezpieczne hasło panelu',PASSWORD_DEFAULT),str_repeat('c',32),'https://approve.hrm.se',fn()=>$now,fn(int $length)=>str_repeat("\x44",$length));
$loginPage=$gateway->handle(new Request('GET','/panel'));
adminCheck($loginPage->status===200&&str_contains($loginPage->body,'WEJDŹ DO PANELU')&&!str_contains($loginPage->body,'Czy HRM słucha AI?'),'unauthenticated panel shows only login');
preg_match('/name="csrf" value="([^"]+)"/',$loginPage->body,$csrfMatch);$loginCsrf=$csrfMatch[1]??'';
$login=$gateway->handle(new Request('POST','/panel/login',['origin'=>'https://approve.hrm.se','content-type'=>'application/x-www-form-urlencoded','user-agent'=>'test'],http_build_query(['csrf'=>$loginCsrf,'password'=>'bezpieczne hasło panelu']),['hrm_board_login_csrf'=>$loginCsrf],[],'127.0.0.1'));
$sessionCookie=headerValue($login->headers,'Set-Cookie');preg_match('/hrm_board_admin=([^;]+)/',$sessionCookie,$sessionMatch);$session=$sessionMatch[1]??'';
adminCheck($login->status===303&&$session!==''&&headerValue($login->headers,'Location')==='/panel','valid password creates private session');
$browserLoginPage=$gateway->handle(new Request('GET','/panel'));
preg_match('/name="csrf" value="([^"]+)"/',$browserLoginPage->body,$browserCsrfMatch);$browserCsrf=$browserCsrfMatch[1]??'';
$browserLogin=$gateway->handle(new Request('POST','/panel/login',['host'=>'approve.hrm.se','sec-fetch-site'=>'same-origin','content-type'=>'application/x-www-form-urlencoded','user-agent'=>'browser'],http_build_query(['csrf'=>$browserCsrf,'password'=>'bezpieczne hasło panelu']),['hrm_board_login_csrf'=>$browserCsrf],[],'127.0.0.1'));
adminCheck($browserLogin->status===303&&str_contains(headerValue($browserLogin->headers,'Set-Cookie'),'hrm_board_admin='),'same-origin browser login works when Origin header is absent');
$wrongPasswordPage=$gateway->handle(new Request('GET','/panel'));
preg_match('/name="csrf" value="([^"]+)"/',$wrongPasswordPage->body,$wrongPasswordCsrfMatch);$wrongPasswordCsrf=$wrongPasswordCsrfMatch[1]??'';
$wrongPassword=$gateway->handle(new Request('POST','/panel/login',['host'=>'approve.hrm.se','sec-fetch-site'=>'same-origin','content-type'=>'application/x-www-form-urlencoded','user-agent'=>'browser'],http_build_query(['csrf'=>$wrongPasswordCsrf,'password'=>'definitely-wrong']),['hrm_board_login_csrf'=>$wrongPasswordCsrf],[],'127.0.0.1'));
adminCheck($wrongPassword->status===200&&str_contains($wrongPassword->body,'Nieprawidłowe hasło')&&!str_contains(headerValue($wrongPassword->headers,'Set-Cookie'),'hrm_board_admin='),'wrong browser password is rejected without a session');
$wrongHostPage=$gateway->handle(new Request('GET','/panel'));
preg_match('/name="csrf" value="([^"]+)"/',$wrongHostPage->body,$wrongHostCsrfMatch);$wrongHostCsrf=$wrongHostCsrfMatch[1]??'';
$wrongHost=$gateway->handle(new Request('POST','/panel/login',['host'=>'evil.invalid','sec-fetch-site'=>'same-origin','content-type'=>'application/x-www-form-urlencoded'],http_build_query(['csrf'=>$wrongHostCsrf,'password'=>'bezpieczne hasło panelu']),['hrm_board_login_csrf'=>$wrongHostCsrf]));
adminCheck($wrongHost->status===403,'missing Origin fallback rejects a different host');
$panel=$gateway->handle(new Request('GET','/panel',[], '', ['hrm_board_admin'=>$session],['tab'=>'new']));
adminCheck($panel->status===200&&str_contains($panel->body,'DO PRZEMYŚLENIA')&&str_contains($panel->body,'AI: WARTO PRZEMYŚLEĆ'),'panel renders primary moderation flow');
adminCheck(!str_contains($panel->body,'<script>alert(1)</script>')&&str_contains($panel->body,'&lt;script&gt;'),'panel escapes untrusted message HTML');
adminCheck($store->operations===[],'GET panel does not mutate moderation data');
$panelCookie=headerValue($panel->headers,'Set-Cookie');preg_match('/hrm_board_panel_csrf=([^;]+)/',$panelCookie,$panelCsrfMatch);$panelCsrf=$panelCsrfMatch[1]??'';
$thinking=$gateway->handle(new Request('POST','/panel',['origin'=>'https://approve.hrm.se','content-type'=>'application/x-www-form-urlencoded'],http_build_query(['operation'=>'thinking','key'=>str_repeat('a',64),'csrf'=>$panelCsrf,'return'=>'/panel?tab=new']),['hrm_board_admin'=>$session,'hrm_board_panel_csrf'=>$panelCsrf]));
adminCheck($thinking->status===303&&$store->operations===[['thinking',str_repeat('a',64)]],'thinking is a durable explicit action');
$wrongOrigin=$gateway->handle(new Request('POST','/panel',['origin'=>'https://evil.invalid','content-type'=>'application/x-www-form-urlencoded'],http_build_query(['operation'=>'thinking','key'=>str_repeat('a',64),'csrf'=>$panelCsrf]),['hrm_board_admin'=>$session,'hrm_board_panel_csrf'=>$panelCsrf]));
adminCheck($wrongOrigin->status===403&&count($store->operations)===1,'cross-origin mutation is rejected');
echo "ALL BOARD ADMIN TESTS PASSED\n";
