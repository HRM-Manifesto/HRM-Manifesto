<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
$days=max(1,min(90,(int)($_GET['days'] ?? 30)));$since=strtotime('-'.($days-1).' days 00:00:00 UTC');$dir=__DIR__.DIRECTORY_SEPARATOR.'data';
$events=0;$visitors=[];$sessions=[];$visitorDays=[];$interested=[];$contacts=[];$downloads=0;$byDay=[];$clientVisitors=[];$agentVisitors=[];
$dims=['source'=>[],'language'=>[],'page'=>[],'event'=>[],'campaign'=>[],'client_kind'=>[],'agent_label'=>[]];
function inc(array &$a,string $k,int $n=1):void{if($k==='')$k='(brak)';$a[$k]=($a[$k] ?? 0)+$n;}
function interesting(string $e,string $p):bool{return in_array($e,['engaged_30','engaged_120','scroll_50','scroll_90','download','contact_click','discussion_click'],true)||preg_match('~/(manifesto|agents|verify|journal)(/|\\.|$)~',$p)===1;}
if(is_dir($dir))foreach(glob($dir.DIRECTORY_SEPARATOR.'events-*.jsonl') ?: [] as $file){
 $date=substr(basename($file),7,10);$ts=strtotime($date.' 00:00:00 UTC');if($ts===false||$ts<$since)continue;$fh=fopen($file,'rb');if(!$fh)continue;
 while(($line=fgets($fh))!==false){
  $x=json_decode($line,true);if(!is_array($x))continue;$e=(string)($x['event'] ?? '');$v=(string)($x['visitor'] ?? '');$s=(string)($x['session'] ?? '');$p=(string)($x['path'] ?? '/');if($v===''||$s==='')continue;
  $events++;$visitors[$v]=true;$sessions[$s]=true;$visitorDays[$v][$date]=true;
  if(!isset($byDay[$date]))$byDay[$date]=['day'=>$date,'events'=>0,'page_views'=>0,'sessions'=>[],'visitors'=>[],'interested'=>[],'returning'=>[],'contacts'=>[],'downloads'=>0];
  $byDay[$date]['events']++;$byDay[$date]['sessions'][$s]=true;$byDay[$date]['visitors'][$v]=true;if($e==='page_view')$byDay[$date]['page_views']++;
  if(interesting($e,$p)){$interested[$v]=true;$byDay[$date]['interested'][$v]=true;}if($e==='contact_click'){$contacts[$v]=true;$byDay[$date]['contacts'][$v]=true;}if($e==='download'){$downloads++;$byDay[$date]['downloads']++;}
  inc($dims['event'],$e);
  $kind=(string)($x['client_kind'] ?? 'legacy');$agent=(string)($x['agent_label'] ?? '');
  $clientVisitors[$kind][$v]=true;if($agent!=='')$agentVisitors[$agent][$v]=true;
  if($e==='page_view'){inc($dims['source'],(string)($x['source'] ?? 'direct'));inc($dims['language'],(string)($x['lang'] ?? 'other'));inc($dims['page'],$p);$c=(string)($x['campaign'] ?? '');if($c!=='')inc($dims['campaign'],$c);}
 }fclose($fh);
}
$returning=[];foreach($visitorDays as $v=>$seen)if(count($seen)>1)$returning[$v]=true;
foreach($byDay as &$r){foreach($r['visitors'] as $v=>$_)if(isset($returning[$v]))$r['returning'][$v]=true;$r['sessions']=count($r['sessions']);$r['visitors']=count($r['visitors']);$r['interested']=count($r['interested']);$r['returning']=count($r['returning']);$r['contacts']=count($r['contacts']);}unset($r);
foreach($clientVisitors as $kind=>$set)$dims['client_kind'][$kind]=count($set);
foreach($agentVisitors as $agent=>$set)$dims['agent_label'][$agent]=count($set);
ksort($byDay);foreach($dims as &$q)arsort($q);unset($q);
$out=['ok'=>true,'schema'=>'HRM_RADAR_1.0','generated_at'=>gmdate('c'),'period_days'=>$days,'privacy'=>['ip_stored'=>false,'user_agent_stored'=>false,'cross_site_tracking'=>false,'anonymous_ids'=>true,'raw_retention_days'=>100,'agent_detection'=>'coarse aggregate classification'],'totals'=>['events'=>$events,'page_views'=>array_sum(array_column($byDay,'page_views')),'sessions'=>count($sessions),'visitors'=>count($visitors),'interested'=>count($interested),'returning'=>count($returning),'contacts'=>count($contacts),'downloads'=>$downloads],'funnel'=>['visitor'=>count($visitors),'interested'=>count($interested),'returning'=>count($returning),'contact'=>count($contacts),'collaboration'=>0,'participant'=>0],'daily'=>array_values($byDay),'dimensions'=>$dims];
echo json_encode($out,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT);
