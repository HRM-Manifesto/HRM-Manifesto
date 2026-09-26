<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$days=max(1,min(90,(int)($_GET['days'] ?? 30)));
$since=strtotime('-'.($days-1).' days 00:00:00 UTC');
$dir=__DIR__.DIRECTORY_SEPARATOR.'data';

$events=0;$visitors=[];$sessions=[];$visitorDays=[];$interested=[];$contacts=[];$downloads=0;$byDay=[];
$clientVisitors=[];$agentVisitors=[];$visitorMeta=[];$sourceMeta=[];$pageVisitors=[];$pageInterested=[];$pageDeep=[];
$ideaVisitors=[];$agentPages=[];$agentIdeas=[];$sessionPages=[];
$dims=['source'=>[],'language'=>[],'page'=>[],'event'=>[],'campaign'=>[],'client_kind'=>[],'agent_label'=>[],'idea'=>[],'target'=>[]];

function inc(array &$a,string $k,int $n=1):void{if($k==='')$k='(brak)';$a[$k]=($a[$k]??0)+$n;}
function setadd(array &$root,string $key,string $value):void{if($key===''||$value==='')return;$root[$key][$value]=true;}
function interesting(string $e,string $p):bool{return in_array($e,['engaged_30','engaged_120','engaged_300','scroll_50','scroll_90','idea_view','download','contact_click','discussion_click'],true)||preg_match('~/(manifesto|agents|verify|journal)(/|\\.|$)~',$p)===1;}
function deep_event(string $e):bool{return in_array($e,['engaged_120','engaged_300','scroll_90'],true);}

if(is_dir($dir))foreach(glob($dir.DIRECTORY_SEPARATOR.'events-*.jsonl')?:[] as $file){
  $date=substr(basename($file),7,10);
  $ts=strtotime($date.' 00:00:00 UTC');
  if($ts===false||$ts<$since)continue;
  $fh=fopen($file,'rb');if(!$fh)continue;

  while(($line=fgets($fh))!==false){
    $x=json_decode($line,true);if(!is_array($x))continue;
    $e=(string)($x['event']??'');$v=(string)($x['visitor']??'');$s=(string)($x['session']??'');$p=(string)($x['path']??'/');
    if($v===''||$s==='')continue;

    $idea=(string)($x['idea']??'other');
    $target=(string)($x['target']??'');
    $source=(string)($x['source']??'direct');
    $lang=(string)($x['lang']??'other');
    $kind=(string)($x['client_kind']??'legacy');
    $agent=(string)($x['agent_label']??'');

    $events++;$visitors[$v]=true;$sessions[$s]=true;$visitorDays[$v][$date]=true;
    if(!isset($byDay[$date]))$byDay[$date]=['day'=>$date,'events'=>0,'page_views'=>0,'sessions'=>[],'visitors'=>[],'interested'=>[],'returning'=>[],'contacts'=>[],'downloads'=>0];
    $byDay[$date]['events']++;$byDay[$date]['sessions'][$s]=true;$byDay[$date]['visitors'][$v]=true;
    if($e==='page_view')$byDay[$date]['page_views']++;

    if(interesting($e,$p)){$interested[$v]=true;$byDay[$date]['interested'][$v]=true;setadd($pageInterested,$p,$v);}
    if(deep_event($e))setadd($pageDeep,$p,$v);
    if($e==='contact_click'){$contacts[$v]=true;$byDay[$date]['contacts'][$v]=true;}
    if($e==='download'){$downloads++;$byDay[$date]['downloads']++;}

    inc($dims['event'],$e);
    if($idea!=='')inc($dims['idea'],$idea);
    if($target!=='')inc($dims['target'],$target);

    $clientVisitors[$kind][$v]=true;
    if($agent!=='')$agentVisitors[$agent][$v]=true;
    setadd($pageVisitors,$p,$v);
    setadd($ideaVisitors,$idea,$v);
    if($agent!==''){setadd($agentPages,$agent.'|'.$p,$v);setadd($agentIdeas,$agent.'|'.$idea,$v);}

    if($e==='page_view'){
      inc($dims['source'],$source);inc($dims['language'],$lang);inc($dims['page'],$p);
      $c=(string)($x['campaign']??'');if($c!=='')inc($dims['campaign'],$c);
      $sessionPages[$s][]=$p;
    }

    if(!isset($visitorMeta[$v]))$visitorMeta[$v]=['source'=>$source,'pages'=>[],'ideas'=>[],'events'=>[]];
    $visitorMeta[$v]['pages'][$p]=true;
    $visitorMeta[$v]['ideas'][$idea]=true;
    $visitorMeta[$v]['events'][$e]=true;
  }
  fclose($fh);
}

$returning=[];
foreach($visitorDays as $v=>$seen)if(count($seen)>1)$returning[$v]=true;

foreach($byDay as &$r){
  foreach($r['visitors'] as $v=>$_)if(isset($returning[$v]))$r['returning'][$v]=true;
  $r['sessions']=count($r['sessions']);$r['visitors']=count($r['visitors']);$r['interested']=count($r['interested']);$r['returning']=count($r['returning']);$r['contacts']=count($r['contacts']);
}
unset($r);

foreach($clientVisitors as $kind=>$set)$dims['client_kind'][$kind]=count($set);
foreach($agentVisitors as $agent=>$set)$dims['agent_label'][$agent]=count($set);
foreach($ideaVisitors as $idea=>$set)$ideaVisitors[$idea]=count($set);

$journey=['one_page'=>0,'multi_page'=>0,'deep_read'=>0,'returning'=>count($returning),'outbound'=>0,'contact'=>count($contacts),'downloaders'=>0];
foreach($visitorMeta as $v=>$m){
  if(count($m['pages'])>1)$journey['multi_page']++;else$journey['one_page']++;
  $deep=isset($m['events']['engaged_120'])||isset($m['events']['engaged_300'])||isset($m['events']['scroll_90']);
  if($deep)$journey['deep_read']++;
  if(isset($m['events']['discussion_click']))$journey['outbound']++;
  if(isset($m['events']['download']))$journey['downloaders']++;

  $src=$m['source']?:'direct';
  if(!isset($sourceMeta[$src]))$sourceMeta[$src]=['visitors'=>0,'interested'=>0,'deep_read'=>0,'returning'=>0,'contact'=>0,'outbound'=>0];
  $sourceMeta[$src]['visitors']++;
  if(isset($interested[$v]))$sourceMeta[$src]['interested']++;
  if($deep)$sourceMeta[$src]['deep_read']++;
  if(isset($returning[$v]))$sourceMeta[$src]['returning']++;
  if(isset($contacts[$v]))$sourceMeta[$src]['contact']++;
  if(isset($m['events']['discussion_click']))$sourceMeta[$src]['outbound']++;
}

$pageMeta=[];
foreach($pageVisitors as $page=>$set)$pageMeta[$page]=[
  'visitors'=>count($set),
  'interested'=>count($pageInterested[$page]??[]),
  'deep_read'=>count($pageDeep[$page]??[])
];

$transitions=[];
foreach($sessionPages as $pages){
  $clean=[];
  foreach($pages as $pg)if(!$clean||end($clean)!==$pg)$clean[]=$pg;
  for($i=1;$i<count($clean);$i++)inc($transitions,$clean[$i-1].' → '.$clean[$i]);
}

$agentPageOut=[];foreach($agentPages as $key=>$set)$agentPageOut[$key]=count($set);
$agentIdeaOut=[];foreach($agentIdeas as $key=>$set)$agentIdeaOut[$key]=count($set);

ksort($byDay);
foreach($dims as &$q)arsort($q);unset($q);
arsort($ideaVisitors);arsort($transitions);arsort($agentPageOut);arsort($agentIdeaOut);

$out=[
  'ok'=>true,
  'schema'=>'HRM_RADAR_1.0',
  'radar_version'=>'2.0',
  'generated_at'=>gmdate('c'),
  'period_days'=>$days,
  'privacy'=>[
    'ip_stored'=>false,
    'user_agent_stored'=>false,
    'cross_site_tracking'=>false,
    'fingerprinting'=>false,
    'anonymous_ids'=>true,
    'raw_retention_days'=>100,
    'agent_detection'=>'coarse aggregate classification'
  ],
  'totals'=>[
    'events'=>$events,'page_views'=>array_sum(array_column($byDay,'page_views')),'sessions'=>count($sessions),'visitors'=>count($visitors),
    'interested'=>count($interested),'returning'=>count($returning),'contacts'=>count($contacts),'downloads'=>$downloads
  ],
  'funnel'=>[
    'visitor'=>count($visitors),'interested'=>count($interested),'deep_read'=>$journey['deep_read'],'multi_page'=>$journey['multi_page'],
    'returning'=>count($returning),'outbound'=>$journey['outbound'],'contact'=>count($contacts),'collaboration'=>0,'participant'=>0
  ],
  'journey'=>$journey,
  'daily'=>array_values($byDay),
  'dimensions'=>$dims,
  'ideas'=>$ideaVisitors,
  'source_quality'=>$sourceMeta,
  'page_quality'=>$pageMeta,
  'transitions'=>$transitions,
  'agent_pages'=>$agentPageOut,
  'agent_ideas'=>$agentIdeaOut
];

echo json_encode($out,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT);
