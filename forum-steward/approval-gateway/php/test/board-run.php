<?php
declare(strict_types=1);

use Hrm\Gateway\BoardCallback;
use Hrm\Gateway\BoardCaseStore;
use Hrm\Gateway\BoardGateway;
use Hrm\Gateway\Request;

$root = dirname(__DIR__);
foreach (['Http.php', 'ApprovalRecord.php', 'BoardGateway.php'] as $source) require_once $root . '/src/' . $source;

final class BoardMemoryStore implements BoardCaseStore
{
    public array $cases = [];
    public int $claims = 0;
    public function create(string $key, string $hash, string $notificationCiphertext, array $submission, int $expires): bool { if (isset($this->cases[$key])) return false; $this->cases[$key] = compact('key','hash','submission','expires','notificationCiphertext') + ['status'=>'pending','notified'=>false]; return true; }
    public function claimNotifications(int $limit): array { $rows=[]; foreach($this->cases as $case) if($case['status']==='pending'&&!$case['notified']&&count($rows)<$limit){$rows[]=['notification_key'=>$case['key'],'submission'=>$case['submission'],'ciphertext'=>$case['notificationCiphertext']];} return $rows; }
    public function completeNotifications(array $keys): int { $count=0; foreach($this->cases as &$case) if(in_array($case['key'],$keys,true)&&!$case['notified']){$case['notified']=true;$count++;} return $count; }
    public function peek(string $hash, int $now): array { foreach ($this->cases as $case) if ($case['hash'] === $hash) return $case['status'] === 'pending' ? ['kind'=>'active','submission'=>$case['submission']] : ['kind'=>'used']; return ['kind'=>'missing']; }
    public function claim(string $hash, int $now): array { foreach ($this->cases as &$case) if ($case['hash'] === $hash && $case['status'] === 'pending') { $case['status']='processing'; $this->claims++; return ['kind'=>'claimed','submission'=>$case['submission']]; } return ['kind'=>'used']; }
    public function complete(string $hash, string $status, ?string $resultUrl = null): void { foreach ($this->cases as &$case) if ($case['hash'] === $hash) { $case['status']=$status; return; } throw new RuntimeException('missing'); }
    public function fail(string $hash): void { foreach ($this->cases as &$case) if ($case['hash'] === $hash) $case['status']='failed'; }
}
final class BoardFakeCallback implements BoardCallback { public array $calls=[]; public function decide(string $id,string $decision,int $now): array { $this->calls[]=[$id,$decision,$now]; return ['updated'=>true,'status'=>$decision==='approve'?'published':'rejected']; } }
function check(bool $condition,string $name):void{if(!$condition)throw new RuntimeException("FAILED: $name");echo "PASS $name\n";}

$store=new BoardMemoryStore();$callback=new BoardFakeCallback();$now=1788256800;
$gateway=new BoardGateway($store,$callback,str_repeat('g',32),str_repeat('n',32),str_repeat('e',32),str_repeat('c',32),'https://approve.hrm.se',fn()=>$now,fn(int $n)=>str_repeat("\x33",$n));
$submission=['id'=>'11111111-1111-4111-8111-111111111111','declared_identity'=>'<Self-declared Agent>','verification_status'=>'unverified','kind'=>'critique','content'=>'<script>alert(1)</script> Krytyka','source_url'=>null,'created_at'=>$now];
$body=json_encode($submission,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);
$register=$gateway->handle(new Request('POST','/api/board-cases',['authorization'=>'Bearer '.str_repeat('g',32),'content-type'=>'application/json'],$body));
check($register->status===201&&json_decode($register->body,true)['notification_queued']===true,'Board case registers and queues notification');
$duplicate=$gateway->handle(new Request('POST','/api/board-cases',['authorization'=>'Bearer '.str_repeat('g',32),'content-type'=>'application/json'],$body));
check(json_decode($duplicate->body,true)['created']===false,'duplicate Board case is idempotent');
$notifications=$gateway->handle(new Request('POST','/api/board-notifications',['authorization'=>'Bearer '.str_repeat('n',32)]));
$notificationData=json_decode($notifications->body,true);
check($notifications->status===200&&count($notificationData['items'])===1&&str_contains($notificationData['items'][0]['links']['approve'],'/b/approve/'),'authorized notification claim returns one encrypted capability link');
$notificationsAgain=$gateway->handle(new Request('POST','/api/board-notifications',['x-hrm-board-authorization'=>'Bearer '.str_repeat('n',32)]));
check(count(json_decode($notificationsAgain->body,true)['items'])===1,'unconfirmed notification remains available after retrieval');
$notificationKey=$notificationData['items'][0]['notification_key'];
$completeBody=json_encode(['operation'=>'complete','notification_keys'=>[$notificationKey]],JSON_THROW_ON_ERROR);
$completed=$gateway->handle(new Request('POST','/api/board-notifications',['authorization'=>'Bearer '.str_repeat('n',32),'content-type'=>'application/json'],$completeBody));
check(json_decode($completed->body,true)['completed']===1,'notification is completed only after email delivery');
$notificationsAfterComplete=$gateway->handle(new Request('POST','/api/board-notifications',['authorization'=>'Bearer '.str_repeat('n',32)]));
check(json_decode($notificationsAfterComplete->body,true)['items']===[],'completed notification is single delivery');
$token=Hrm\Gateway\base64UrlEncode(str_repeat("\x33",32));
$show=$gateway->handle(new Request('GET','/b/approve/'.$token));
check($show->status===200&&!str_contains($show->body,'<script>')&&str_contains($show->body,'&lt;script&gt;'),'moderation page escapes untrusted HTML');
check($store->claims===0,'GET moderation page does not mutate state');
preg_match('/name="csrf" value="([^"]+)"/',$show->body,$match);$csrf=$match[1]??'';
$decision=$gateway->handle(new Request('POST','/board-decision/approve',['origin'=>'https://approve.hrm.se','content-type'=>'application/x-www-form-urlencoded'],http_build_query(['csrf'=>$csrf]),['hrm_board_cap'=>$token,'hrm_board_csrf'=>$csrf]));
check($decision->status===200&&$store->claims===1&&count($callback->calls)===1&&$callback->calls[0][1]==='approve','POST approval performs one callback');
$replay=$gateway->handle(new Request('POST','/board-decision/approve',['origin'=>'https://approve.hrm.se','content-type'=>'application/x-www-form-urlencoded'],http_build_query(['csrf'=>$csrf]),['hrm_board_cap'=>$token,'hrm_board_csrf'=>$csrf]));
check($replay->status===409&&count($callback->calls)===1,'approval capability is single use');
echo "ALL BOARD GATEWAY TESTS PASSED\n";
