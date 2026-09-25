<?php
declare(strict_types=1);
header('Cache-Control: no-store, max-age=0');
header('Content-Type: application/json; charset=utf-8');
header('X-HRM-Radar-Version: 1.1-agent-detection');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo '{"ok":false}'; exit; }
$origin=$_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin!=='' && $origin!=='https://hrm.se') { http_response_code(403); echo '{"ok":false}'; exit; }
$len=(int)($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($len<=0 || $len>8192) { http_response_code(413); echo '{"ok":false}'; exit; }
$data=json_decode(file_get_contents('php://input') ?: '',true);
if (!is_array($data)) { http_response_code(400); echo '{"ok":false}'; exit; }
$allowed=['page_view','engaged_30','engaged_120','scroll_50','scroll_90','download','contact_click','discussion_click'];
$event=strtolower((string)($data['event'] ?? ''));
if (!in_array($event,$allowed,true)) { http_response_code(400); echo '{"ok":false}'; exit; }
function ct($v,int $m=160):string{$v=trim((string)$v);$v=preg_replace('/[\x00-\x1F\x7F]/u','',$v) ?? '';return mb_substr($v,0,$m,'UTF-8');}
function cp($v):string{$p=ct($v,240);if($p===''||$p[0]!=='/')return '/';$z=parse_url($p);return ct($z['path'] ?? '/',240);}
function classify_client(string $ua):array{
  $u=strtolower($ua);
  $known=[
    'oai-searchbot'=>'OAI-SearchBot',
    'oai-adsbot'=>'OAI-AdsBot',
    'chatgpt-user'=>'ChatGPT-User',
    'gptbot'=>'GPTBot',
    'claudebot'=>'ClaudeBot',
    'claude-user'=>'Claude-User',
    'perplexitybot'=>'PerplexityBot',
    'googlebot'=>'Googlebot',
    'bingbot'=>'Bingbot',
    'applebot'=>'Applebot',
    'amazonbot'=>'Amazonbot',
    'bytespider'=>'Bytespider',
    'meta-externalagent'=>'Meta-ExternalAgent',
    'ccbot'=>'CCBot'
  ];
  foreach($known as $needle=>$label){if(str_contains($u,$needle))return ['bot',$label,'high'];}
  if(preg_match('/bot|crawler|spider|slurp|headless|scrapy|python-requests|curl\\/|wget\\//',$u))return ['automation','Inny bot/crawler','medium'];
  if($u==='')return ['unknown','','low'];
  return ['browser','','low'];
}
[$clientKind,$agentLabel,$agentConfidence]=classify_client((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
$anon=ct($data['anon'] ?? '',100);$session=ct($data['session'] ?? '',100);
if ($anon===''||$session==='') { http_response_code(400); echo '{"ok":false}'; exit; }
$ref=ct($data['referrer'] ?? '',160);
if($ref!==''){$h=parse_url(str_contains($ref,'://')?$ref:'https://'.$ref,PHP_URL_HOST);$ref=ct($h ?: '',120);}
$item=['at'=>gmdate('c'),'event'=>$event,'visitor'=>hash('sha256','hrm-radar-v1|'.$anon),'session'=>hash('sha256','hrm-radar-session-v1|'.$session),'path'=>cp($data['path'] ?? '/'),'lang'=>in_array(($data['lang'] ?? ''),['pl','en','sv'],true)?$data['lang']:'other','source'=>ct($data['source'] ?? 'direct',80),'medium'=>ct($data['medium'] ?? '',80),'campaign'=>ct($data['campaign'] ?? '',100),'content'=>ct($data['content'] ?? '',100),'referrer'=>$ref,'visit_no'=>max(1,min(9999,(int)($data['visit_no'] ?? 1))),'client_kind'=>$clientKind,'agent_label'=>$agentLabel,'agent_confidence'=>$agentConfidence];
$dir=__DIR__.DIRECTORY_SEPARATOR.'data';
if(!is_dir($dir)&&!mkdir($dir,0750,true)&&!is_dir($dir)){http_response_code(500);echo '{"ok":false}';exit;}
$file=$dir.DIRECTORY_SEPARATOR.'events-'.gmdate('Y-m-d').'.jsonl';
$line=json_encode($item,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE);
if($line===false||file_put_contents($file,$line.PHP_EOL,FILE_APPEND|LOCK_EX)===false){http_response_code(500);echo '{"ok":false}';exit;}
foreach(glob($dir.DIRECTORY_SEPARATOR.'events-*.jsonl') ?: [] as $old){if(is_file($old)&&filemtime($old)<time()-100*86400)@unlink($old);}
http_response_code(204);
