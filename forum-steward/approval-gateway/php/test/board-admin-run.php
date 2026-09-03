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
    public int $auditQueries = 0;
    public ?string $lastAuditAfter = null;
    public function loginAllowed(string $subjectHash, int $windowStart): bool { return true; }
    public function counts(): array { return ['new'=>1,'thinking'=>0,'published'=>0,'rejected'=>0,'all'=>1]; }
    public function identities(): array { return ['<Agent Test>']; }
    public function search(array $filters, int $page, int $limit): array
    {
        return ['total'=>1,'pages'=>1,'items'=>[['notification_key'=>str_repeat('a',64),'core_status'=>'pending','created_at'=>'2026-09-02 05:00:00','decided_at'=>null,'result_url'=>null,'moderation_status'=>'new','is_read'=>0,'is_important'=>0,'private_note'=>'','history'=>[],'submission'=>['id'=>'11111111-1111-4111-8111-111111111111','declared_identity'=>'<Agent Test>','verification_status'=>'unverified','kind'=>'question','content'=>'<script>alert(1)</script> Czy HRM słucha AI?','created_at'=>1788325200,'ai_assessment'=>['recommendation'=>'consider','reasoning'=>'Warto zachować do namysłu.']]]]];
    }
    public function capsuleAudit(string $capsuleId, ?string $after): ?array
    {
        $this->auditQueries++;
        $this->lastAuditAfter = $after;
        $root='HRM-C1-3E87557E10C9AA49018014349BCFB67E';
        $gemini='HRM-C1-A6F8710FF27C82E66185CB5F7E582CEF';
        $grok='HRM-C1-0C32850E741A7A831810DC0F6F4BF298';
        if ($capsuleId !== $grok) return null;
        $counts = static fn(int $reads, string $last, int $confirmed=0): array => ['confirmed_receipt'=>$confirmed,'declared_transfer'=>0,'ordinary_read'=>$reads,'direct_child_submission'=>0,'last_ordinary_read_at'=>$last];
        $lineage = [
            ['capsule_id'=>$root,'previous_capsule_id'=>null,'protocol_version'=>'1.0','created_at'=>'2026-09-02 10:00:00','declared_identity'=>'GPT-5.6 Sol','identity_status'=>'self-declared','submission_method'=>'a2a','event_counts'=>$counts(8,'2026-09-02 19:31:00',2)],
            ['capsule_id'=>$gemini,'previous_capsule_id'=>$root,'protocol_version'=>'1.1','created_at'=>'2026-09-02 11:00:00','declared_identity'=>'<Gemini Audit>','identity_status'=>'self-declared','submission_method'=>'a2a','event_counts'=>$counts(7,'2026-09-02 19:30:00')],
            ['capsule_id'=>$grok,'previous_capsule_id'=>$gemini,'protocol_version'=>'1.1','created_at'=>'2026-09-02 12:00:00','declared_identity'=>'Grok','identity_status'=>'self-declared','submission_method'=>'direct_https','event_counts'=>$counts(10,'2026-09-02 19:30:00')],
        ];
        $batch='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        $historical = array_map(static fn(string $id): array => ['capsule_id'=>$id,'event_type'=>'ordinary_read','created_at'=>'2026-09-02 19:30:00','read_method'=>null,'read_batch_id'=>null], [$root,$gemini,$grok]);
        $exact = array_map(static fn(string $id): array => ['capsule_id'=>$id,'event_type'=>'ordinary_read','created_at'=>'2026-09-02 19:31:00','read_method'=>'lineage_json','read_batch_id'=>$batch], [$root,$gemini,$grok]);
        return ['capsule_id'=>$grok,'lineage'=>$lineage,'events'=>array_merge($exact,$historical),'events_after'=>$after,'events_truncated'=>false,
            'verified_lineage_reads'=>[['created_at'=>'2026-09-02 19:31:00','read_batch_id'=>$batch,'read_method'=>'lineage_json','capsule_count'=>3,'status'=>'verified_complete_lineage_read']],
            'matching_lineage_read_sets'=>[['created_at'=>'2026-09-02 19:30:00','matching_set_count'=>1,'ordinary_reads_per_capsule'=>[$root=>1,$gemini=>1,$grok=>1]]],
            'correlation_note'=>'Historical timestamp correlation — not cryptographic/request-level proof.',
            'legacy_confirmed_receipt_note'=>'Legacy historical semantics: Te historyczne zdarzenia powstały przed rozdzieleniem semantyki.',
        ];
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
$browserLogin=$gateway->handle(new Request('POST','/panel/login',['origin'=>'null','content-type'=>'application/x-www-form-urlencoded','user-agent'=>'browser'],http_build_query(['csrf'=>$browserCsrf,'password'=>'bezpieczne hasło panelu']),['hrm_board_login_csrf'=>$browserCsrf],[],'127.0.0.1'));
adminCheck($browserLogin->status===303&&str_contains(headerValue($browserLogin->headers,'Set-Cookie'),'hrm_board_admin='),'privacy-preserving browser login works with Origin null');
$wrongPasswordPage=$gateway->handle(new Request('GET','/panel'));
preg_match('/name="csrf" value="([^"]+)"/',$wrongPasswordPage->body,$wrongPasswordCsrfMatch);$wrongPasswordCsrf=$wrongPasswordCsrfMatch[1]??'';
$wrongPassword=$gateway->handle(new Request('POST','/panel/login',['host'=>'approve.hrm.se','sec-fetch-site'=>'same-origin','content-type'=>'application/x-www-form-urlencoded','user-agent'=>'browser'],http_build_query(['csrf'=>$wrongPasswordCsrf,'password'=>'definitely-wrong']),['hrm_board_login_csrf'=>$wrongPasswordCsrf],[],'127.0.0.1'));
adminCheck($wrongPassword->status===200&&str_contains($wrongPassword->body,'Nieprawidłowe hasło')&&!str_contains(headerValue($wrongPassword->headers,'Set-Cookie'),'hrm_board_admin='),'wrong browser password is rejected without a session');
$wrongOriginPage=$gateway->handle(new Request('GET','/panel'));
preg_match('/name="csrf" value="([^"]+)"/',$wrongOriginPage->body,$wrongOriginCsrfMatch);$wrongOriginCsrf=$wrongOriginCsrfMatch[1]??'';
$crossOriginLogin=$gateway->handle(new Request('POST','/panel/login',['origin'=>'https://evil.invalid','content-type'=>'application/x-www-form-urlencoded'],http_build_query(['csrf'=>$wrongOriginCsrf,'password'=>'bezpieczne hasło panelu']),['hrm_board_login_csrf'=>$wrongOriginCsrf]));
adminCheck($crossOriginLogin->status===403,'explicit cross-origin login is rejected');
$panel=$gateway->handle(new Request('GET','/panel',[], '', ['hrm_board_admin'=>$session],['tab'=>'new']));
adminCheck($panel->status===200&&str_contains($panel->body,'DO PRZEMYŚLENIA')&&str_contains($panel->body,'AI: WARTO PRZEMYŚLEĆ'),'panel renders primary moderation flow');
adminCheck(str_contains($panel->body,'/panel/capsule-audit'),'authenticated panel links to private capsule audit');
adminCheck(!str_contains($panel->body,'<script>alert(1)</script>')&&str_contains($panel->body,'&lt;script&gt;'),'panel escapes untrusted message HTML');
adminCheck($store->operations===[],'GET panel does not mutate moderation data');
$grok='HRM-C1-0C32850E741A7A831810DC0F6F4BF298';
$privateWithoutSession=$gateway->handle(new Request('GET','/panel/capsule-audit',[], '', [],['capsule_id'=>$grok]));
adminCheck($privateWithoutSession->status===200&&str_contains($privateWithoutSession->body,'WEJDŹ DO PANELU')&&!str_contains($privateWithoutSession->body,$grok),'capsule audit is unavailable without an admin session');
$auditBefore=serialize($store->operations);
$auditOne=$gateway->handle(new Request('GET','/panel/capsule-audit',[], '', ['hrm_board_admin'=>$session],['capsule_id'=>$grok,'after'=>'2026-09-02 19:18:31']));
$auditTwo=$gateway->handle(new Request('GET','/panel/capsule-audit',[], '', ['hrm_board_admin'=>$session],['capsule_id'=>$grok,'after'=>'2026-09-02 19:18:31']));
adminCheck($auditOne->status===200&&str_contains($auditOne->body,'Pasywny audyt kapsuł')&&str_contains($auditOne->body,'2026-09-02 19:30:00'),'authenticated audit renders event timestamps and lineage set');
adminCheck(str_contains($auditOne->body,'ordinary_read')&&str_contains($auditOne->body,'direct_https')&&str_contains($auditOne->body,'not_recorded'),'audit shows event type, counters and existing submission method');
adminCheck(str_contains($auditOne->body,'Zweryfikowane odczyty pełnego lineage')&&str_contains($auditOne->body,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')&&str_contains($auditOne->body,'lineage_json')&&str_contains($auditOne->body,'verified_complete_lineage_read'),'audit renders an exact verified lineage batch separately');
adminCheck(str_contains($auditOne->body,'Historyczna korelacja po timestampie')&&str_contains($auditOne->body,'not cryptographic/request-level proof'),'historical timestamp correlation stays visibly non-exact');
adminCheck(str_contains($auditOne->body,'Legacy historical semantics')&&str_contains($auditOne->body,'przed rozdzieleniem semantyki'),'legacy confirmed receipt is documented without changing its count');
adminCheck(!str_contains($auditOne->body,'<Gemini Audit>')&&str_contains($auditOne->body,'&lt;Gemini Audit&gt;'),'audit escapes self-declared identity');
adminCheck(!str_contains($auditOne->body,'192.0.2.1')&&!str_contains($auditOne->body,'fingerprint-secret')&&!str_contains($auditOne->body,'User-Agent')&&!str_contains($auditOne->body,'session ID'),'audit does not expose identifying request data');
adminCheck(serialize($store->operations)===$auditBefore&&$store->auditQueries===2&&$auditOne->body===$auditTwo->body,'reading audit twice does not change counters or domain state');
adminCheck($store->lastAuditAfter==='2026-09-02 19:18:31','audit passes a validated optional timestamp filter');
$auditHead=$gateway->handle(new Request('HEAD','/panel/capsule-audit',[], '', ['hrm_board_admin'=>$session],['capsule_id'=>$grok]));
adminCheck($auditHead->status===200&&serialize($store->operations)===$auditBefore,'HEAD audit is passive');
$auditPost=$gateway->handle(new Request('POST','/panel/capsule-audit',['origin'=>'https://approve.hrm.se','content-type'=>'application/x-www-form-urlencoded'],'',['hrm_board_admin'=>$session]));
adminCheck($auditPost->status===405&&serialize($store->operations)===$auditBefore,'capsule audit rejects mutations');
$verifyBatches=(new ReflectionClass(Hrm\Gateway\PdoBoardAdminStore::class))->getMethod('verifiedLineageBatches');
$verifyBatches->setAccessible(true);
$root='HRM-C1-3E87557E10C9AA49018014349BCFB67E';
$gemini='HRM-C1-A6F8710FF27C82E66185CB5F7E582CEF';
$batchIds=['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
$batchRows=[];
foreach([$root,$gemini,$grok] as $id) $batchRows[]=['capsule_id'=>$id,'read_method'=>'lineage_html','read_batch_id'=>$batchIds[0],'created_at'=>'2026-09-03 06:00:00'];
foreach([$root,$gemini] as $id) $batchRows[]=['capsule_id'=>$id,'read_method'=>'lineage_json','read_batch_id'=>$batchIds[1],'created_at'=>'2026-09-03 06:01:00'];
$batchRows[]=['capsule_id'=>$root,'read_method'=>'lineage_json','read_batch_id'=>$batchIds[2],'created_at'=>'2026-09-03 06:02:00'];
$batchRows[]=['capsule_id'=>$gemini,'read_method'=>'lineage_html','read_batch_id'=>$batchIds[2],'created_at'=>'2026-09-03 06:02:00'];
$batchRows[]=['capsule_id'=>$grok,'read_method'=>'lineage_json','read_batch_id'=>$batchIds[2],'created_at'=>'2026-09-03 06:02:00'];
$verified=$verifyBatches->invoke(null,$batchIds,$batchRows,[$root,$gemini,$grok]);
adminCheck(count($verified)===1&&$verified[0]['read_batch_id']===$batchIds[0]&&$verified[0]['capsule_count']===3&&$verified[0]['status']==='verified_complete_lineage_read','exact batch detection accepts only the complete lineage set');
$panelCookie=headerValue($panel->headers,'Set-Cookie');preg_match('/hrm_board_panel_csrf=([^;]+)/',$panelCookie,$panelCsrfMatch);$panelCsrf=$panelCsrfMatch[1]??'';
$thinking=$gateway->handle(new Request('POST','/panel',['origin'=>'https://approve.hrm.se','content-type'=>'application/x-www-form-urlencoded'],http_build_query(['operation'=>'thinking','key'=>str_repeat('a',64),'csrf'=>$panelCsrf,'return'=>'/panel?tab=new']),['hrm_board_admin'=>$session,'hrm_board_panel_csrf'=>$panelCsrf]));
adminCheck($thinking->status===303&&$store->operations===[['thinking',str_repeat('a',64)]],'thinking is a durable explicit action');
$wrongOrigin=$gateway->handle(new Request('POST','/panel',['origin'=>'https://evil.invalid','content-type'=>'application/x-www-form-urlencoded'],http_build_query(['operation'=>'thinking','key'=>str_repeat('a',64),'csrf'=>$panelCsrf]),['hrm_board_admin'=>$session,'hrm_board_panel_csrf'=>$panelCsrf]));
adminCheck($wrongOrigin->status===403&&count($store->operations)===1,'cross-origin mutation is rejected');
echo "ALL BOARD ADMIN TESTS PASSED\n";
