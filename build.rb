#!/usr/bin/env ruby
require 'yaml'
require 'digest'
ROOT = File.expand_path(__dir__)
NAME = 'VMware vSAN by HTTP'
def uid(s)
  # Stable UUID with RFC 4122 version and variant bits required by Zabbix.
  id=Digest::MD5.hexdigest('vsan-http-v1:' + s)
  id[12]='4'
  id[16]=((id[16].to_i(16) & 0x3) | 0x8).to_s(16)
  id
end
def jp(path); {'type'=>'JSONPATH','parameters'=>[path], 'error_handler'=>'DISCARD_VALUE'}; end
def js(code); {'type'=>'JAVASCRIPT','parameters'=>[code]}; end
def dep(name,key,master,path,type='CHAR',units=nil)
  h={'uuid'=>uid(key),'name'=>name,'type'=>'DEPENDENT','key'=>key,'history'=>'7d','trends'=>'0','value_type'=>type,'preprocessing'=>[jp(path)],'master_item'=>{'key'=>master},'tags'=>[{'tag'=>'component','value'=>'vsan'}]}
  h['units']=units if units
  if %w[UNSIGNED FLOAT].include?(type); h['trends']='90d'; end
  h
end
def proto(name,key,master,path,type='CHAR',units=nil)
  dep(name,key,master,path,type,units)
end
def trigger(name,expr,priority,details={})
  result={'uuid'=>uid('trigger:'+name),'expression'=>expr,'name'=>name,'priority'=>priority,'tags'=>[{'tag'=>'scope','value'=>'availability'}]}.merge(details)
  result['event_name']="#{name}: {ITEM.LASTVALUE1}" if details.key?('opdata')
  result
end
script=File.read(File.join(ROOT,'src/collector.js'))
params=[['url','{$VSAN.URL}'],['username','{$VSAN.USERNAME}'],['password','{$VSAN.PASSWORD}'],['proxy','{$VSAN.HTTP.PROXY}'],['max_age','{$VSAN.HEALTH.MAX.AGE}'],['perf_max_age','{$VSAN.PERF.MAX.AGE}'],['diskmeta_max_age','{$VSAN.DISKMETA.MAX.AGE}']]
items=[]
%w[inventory health capacity objects resync disks diskmeta performance topology witness pools smart].each do |mode|
  key="vsan.#{mode}.get"
  enabled=['inventory','topology'].include?(mode) ? '1' : "{$VSAN.#{mode.upcase}.ENABLED}"
  items << {'uuid'=>uid(key),'name'=>"vSAN: Get #{mode}",'type'=>'SCRIPT','key'=>key,'delay'=>"{$VSAN.INTERVAL.#{mode.upcase}}",'history'=>'0','trends'=>'0','value_type'=>'TEXT','params'=>script,'timeout'=>'{$VSAN.TIMEOUT}', 'parameters'=>(params+[['mode',mode],['enabled',enabled]]).map{|a| {'name'=>a[0], 'value'=>a[1]}}, 'tags'=>[{'tag'=>'component','value'=>'raw'}]}
  err=dep("vSAN: #{mode.capitalize} API error", "vsan.#{mode}.error", key, '$.error','TEXT')
  deps=[{'name'=>'vSAN: vCenter authentication failed','expression'=>"length(last(/#{NAME}/vsan.api.availability.error))>0"}, {'name'=>'vSAN: vCenter availability check has no data','expression'=>"nodata(/#{NAME}/vsan.api.availability.error,{$VSAN.API.NODATA})=1"}]
  err['triggers']=[trigger("vSAN: #{mode.capitalize} collection failed", "length(last(/#{NAME}/vsan.#{mode}.error))>0",'AVERAGE',{'opdata'=>'{ITEM.LASTVALUE}','dependencies'=>deps})]
  items << err
  items << dep("vSAN: #{mode.capitalize} monitoring state", "vsan.#{mode}.state", key, '$.state') unless ['inventory','topology'].include?(mode)
  nodata_macro=['inventory','pools'].include?(mode) ? '{$VSAN.API.NODATA.SLOW}' : (mode=='diskmeta' ? '{$VSAN.API.NODATA.METADATA}' : '{$VSAN.API.NODATA}')
  err['triggers'] << trigger("vSAN: #{mode.capitalize} collector has no data", "nodata(/#{NAME}/vsan.#{mode}.error,#{nodata_macro})=1",'AVERAGE',{'dependencies'=>deps})
end
availability=dep('vSAN: vCenter authentication error','vsan.api.availability.error','vsan.topology.get','$.availability_error','TEXT')
availability['triggers']=[trigger('vSAN: vCenter authentication failed',"length(last(/#{NAME}/vsan.api.availability.error))>0",'AVERAGE',{'opdata'=>'{ITEM.LASTVALUE}'}),trigger('vSAN: vCenter availability check has no data',"nodata(/#{NAME}/vsan.api.availability.error,{$VSAN.API.NODATA})=1",'AVERAGE')]
items << availability
[['vSAN: Discovered clusters','vsan.cluster.count','vsan.inventory.get','clusters.length'],
 ['vSAN: Health clusters with collection errors','vsan.health.partial','vsan.health.get','partial'],
 ['vSAN: Capacity clusters with collection errors','vsan.capacity.partial','vsan.capacity.get','partial'],
 ['vSAN: Object health clusters with collection errors','vsan.objects.partial','vsan.objects.get','partial'],
 ['vSAN: Resync clusters with collection errors','vsan.resync.partial','vsan.resync.get','partial'],
 ['vSAN: Disk health clusters with collection errors','vsan.disks.partial','vsan.disks.get','partial'],
 ['vSAN: Disk metadata clusters with collection errors','vsan.diskmeta.partial','vsan.diskmeta.get','partial'],
 ['vSAN: Performance clusters with collection errors','vsan.performance.partial','vsan.performance.get','partial'],
 ['vSAN: Witness clusters with collection errors','vsan.witness.partial','vsan.witness.get','partial'],
 ['vSAN: Pool clusters with incomplete collection','vsan.pools.partial','vsan.pools.get','partial'],
 ['vSAN: S.M.A.R.T. clusters with collection errors','vsan.smart.partial','vsan.smart.get','partial']].each do |name,key,master,field|
  item=dep(name,key,master,'$.partial','UNSIGNED')
  item['preprocessing']=[js("var x=JSON.parse(value); if(x.error) throw x.error; return x.#{field};").merge('error_handler'=>'DISCARD_VALUE')]
  if key=='vsan.pools.partial'
    item['triggers']=[trigger('vSAN: Storage pool collection is incomplete',"last(/#{NAME}/vsan.pools.partial)>0 and nodata(/#{NAME}/vsan.pools.partial,{$VSAN.API.NODATA.SLOW})=0",'WARNING',{'opdata'=>'Clusters: {ITEM.LASTVALUE}','dependencies'=>[{'name'=>'vSAN: Pools collection failed','expression'=>"length(last(/#{NAME}/vsan.pools.error))>0"}]})]
  end
  items << item
end
items << dep('vSAN: Discovered API version','vsan.api.version','vsan.health.get','$.version')
cluster_js=%q{var x=JSON.parse(value); if(x.error) throw x.error; return JSON.stringify(x.clusters.map(function(c){return {'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.ARCH}':c.architecture};}));}
cluster_rule={'uuid'=>uid('lld:cluster'),'name'=>'vSAN cluster discovery','type'=>'DEPENDENT','key'=>'vsan.cluster.discovery','filter'=>{'evaltype'=>'AND','conditions'=>[{'macro'=>'{#VSAN.NAME}','value'=>'{$VSAN.CLUSTER.MATCHES}'},{'macro'=>'{#VSAN.NAME}','value'=>'{$VSAN.CLUSTER.NOT_MATCHES}','operator'=>'NOT_MATCHES_REGEX'}]},'lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Discover vSAN-enabled clusters by vCenter managed object ID. Failed inventory is not treated as an empty result.','item_prototypes'=>[],'master_item'=>{'key'=>'vsan.inventory.get'},'preprocessing'=>[js(cluster_js)]}
pfx='$.data["{#VSAN.ID}"].value.'
[["Total capacity",'total','B','UNSIGNED'],["Free capacity",'free','B','UNSIGNED'],["Used capacity",'used','B','UNSIGNED'],["Used capacity percentage",'used_percent','%','FLOAT'],["Free capacity percentage",'free_percent','%','FLOAT']].each do |name,f,unit,t|
  p=proto("vSAN [{#VSAN.NAME}]: #{name}","vsan.cluster.capacity.#{f}[{#VSAN.ID}]",'vsan.capacity.get',pfx+f,t,unit)
  if f=='used_percent'
    metric="/#{NAME}/vsan.cluster.capacity.used_percent[{#VSAN.ID}]"
    levels=[['critical','CRIT','HIGH','5m'],['high','HIGH','AVERAGE','10m'],['warning','WARN','WARNING','15m']]
    p['trigger_prototypes']=levels.map do |label,macro,priority,period|
      threshold="{$VSAN.CAPACITY.#{macro}:\"{#VSAN.ID}\"}"
      expr="min(#{metric},#{period})>#{threshold} and nodata(#{metric},{$VSAN.API.NODATA})=0"
      recovery="last(#{metric})<#{threshold}-3 or nodata(#{metric},{$VSAN.API.NODATA})=1"
      extra={'opdata'=>'Used: {ITEM.LASTVALUE}','recovery_mode'=>'RECOVERY_EXPRESSION','recovery_expression'=>recovery}
      if label!='critical'
        parent=label=='high' ? levels[0] : levels[1]
        parent_threshold="{$VSAN.CAPACITY.#{parent[1]}:\"{#VSAN.ID}\"}"
        pexpr="min(#{metric},#{parent[3]})>#{parent_threshold} and nodata(#{metric},{$VSAN.API.NODATA})=0"
        prec="last(#{metric})<#{parent_threshold}-3 or nodata(#{metric},{$VSAN.API.NODATA})=1"
        extra['dependencies']=[{'name'=>"vSAN [{#VSAN.NAME}]: Capacity usage is #{parent[0]}",'expression'=>pexpr,'recovery_expression'=>prec}]
      end
      trigger("vSAN [{#VSAN.NAME}]: Capacity usage is #{label}",expr,priority,extra)
    end
  end
  cluster_rule['item_prototypes'] << p
end
['health','capacity','objects','resync','disks','diskmeta','performance','witness','pools','smart'].each do |mode|
  p=proto("vSAN [{#VSAN.NAME}]: #{mode.capitalize} collection error","vsan.cluster.#{mode}.error[{#VSAN.ID}]","vsan.#{mode}.get",'$.data["{#VSAN.ID}"].error','TEXT')
  item_path="/#{NAME}/vsan.cluster.#{mode}.error[{#VSAN.ID}]"
  nd=mode=='pools' ? '{$VSAN.API.NODATA.SLOW}' : (mode=='diskmeta' ? '{$VSAN.API.NODATA.METADATA}' : '{$VSAN.API.NODATA}')
  p['trigger_prototypes']=[trigger("vSAN [{#VSAN.NAME}]: #{mode.capitalize} data unavailable", "length(last(#{item_path}))>0 and nodata(#{item_path},#{nd})=0", 'WARNING', {'opdata'=>'{ITEM.LASTVALUE}','dependencies'=>[{'name'=>"vSAN: #{mode.capitalize} collection failed",'expression'=>"length(last(/#{NAME}/vsan.#{mode}.error))>0"}]})]
  cluster_rule['item_prototypes'] << p
end
h=proto('vSAN [{#VSAN.NAME}]: Overall health','vsan.cluster.health[{#VSAN.ID}]','vsan.health.get',pfx+'status')
h['valuemap']={'name'=>'vSAN health status'}
red_expr="last(/#{NAME}/vsan.cluster.health[{#VSAN.ID}])=\"red\" and nodata(/#{NAME}/vsan.cluster.health[{#VSAN.ID}],{$VSAN.API.NODATA})=0"
yellow_expr="last(/#{NAME}/vsan.cluster.health[{#VSAN.ID}])=\"yellow\" and nodata(/#{NAME}/vsan.cluster.health[{#VSAN.ID}],{$VSAN.API.NODATA})=0"
h['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Overall health is red',red_expr,'HIGH',{'opdata'=>'{ITEM.LASTVALUE}'}),
  trigger('vSAN [{#VSAN.NAME}]: Overall health is yellow',yellow_expr,'WARNING',{'opdata'=>'{ITEM.LASTVALUE}','dependencies'=>[{'name'=>'vSAN [{#VSAN.NAME}]: Overall health is red','expression'=>red_expr}]})]
cluster_rule['item_prototypes'] << h
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Health description','vsan.cluster.health.description[{#VSAN.ID}]','vsan.health.get',pfx+'description','TEXT')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Health cache timestamp','vsan.cluster.health.timestamp[{#VSAN.ID}]','vsan.health.get',pfx+'timestamp')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Health cache age','vsan.cluster.health.cache.age[{#VSAN.ID}]','vsan.health.get',pfx+'cache_age','UNSIGNED','s')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Capacity metric warning','vsan.cluster.capacity.warning[{#VSAN.ID}]','vsan.capacity.get',pfx+'warning','TEXT')
[['overhead','Object redundancy overhead'],['temporary_overhead','Object temporary overhead'],['primary','Object primary data'],['provisioned','Object provisioned capacity'],['reserved','Object policy reserved capacity'],['over_reserved','Object over-reserved capacity'],['physical_used','Object physical used capacity'],['object_used','Object used capacity'],['snapshot_used','vSAN snapshots physical usage']].each do |f,label|
  cluster_rule['item_prototypes'] << proto("vSAN [{#VSAN.NAME}]: #{label}","vsan.cluster.capacity.#{f}[{#VSAN.ID}]",'vsan.capacity.get',pfx+f,'UNSIGNED','B')
end
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Capacity overview warning','vsan.cluster.capacity.overview.warning[{#VSAN.ID}]','vsan.capacity.get',pfx+'overview_warning','TEXT')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Capacity category warning','vsan.cluster.capacity.category.warning[{#VSAN.ID}]','vsan.capacity.get',pfx+'detail_warning','TEXT')
cache_error=proto('vSAN [{#VSAN.NAME}]: Health cache error','vsan.cluster.health.cache.error[{#VSAN.ID}]','vsan.health.get',pfx+'cache_error','TEXT')
cache_error['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Health cache is unavailable or stale',"length(last(/#{NAME}/vsan.cluster.health.cache.error[{#VSAN.ID}]))>0 and nodata(/#{NAME}/vsan.cluster.health.cache.error[{#VSAN.ID}],{$VSAN.API.NODATA})=0",'WARNING',{'opdata'=>'{ITEM.LASTVALUE}'})]
cluster_rule['item_prototypes'] << cache_error
network_issue=proto('vSAN [{#VSAN.NAME}]: Cached network issue','vsan.cluster.network.issue[{#VSAN.ID}]','vsan.health.get',pfx+'network_issue','UNSIGNED')
network_issue['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Cached network health reports an issue',"last(/#{NAME}/#{network_issue['key']})=1 and length(last(/#{NAME}/vsan.cluster.health.cache.error[{#VSAN.ID}]))=0 and nodata(/#{NAME}/#{network_issue['key']},{$VSAN.API.NODATA})=0",'AVERAGE',{'opdata'=>'{ITEM.LASTVALUE}'})]
cluster_rule['item_prototypes'] << network_issue
partitions=proto('vSAN [{#VSAN.NAME}]: Network partitions','vsan.cluster.network.partitions[{#VSAN.ID}]','vsan.health.get',pfx+'network_partitions','UNSIGNED')
partitions['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Multiple network partitions detected',"last(/#{NAME}/#{partitions['key']})>1 and length(last(/#{NAME}/vsan.cluster.health.cache.error[{#VSAN.ID}]))=0 and nodata(/#{NAME}/#{partitions['key']},{$VSAN.API.NODATA})=0",'HIGH',{'opdata'=>'Partitions: {ITEM.LASTVALUE}'})]
cluster_rule['item_prototypes'] << partitions
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Network health warning','vsan.cluster.network.warning[{#VSAN.ID}]','vsan.health.get',pfx+'network_warning','TEXT')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Architecture','vsan.cluster.architecture[{#VSAN.ID}]','vsan.inventory.get','$.clusters[?(@.id == "{#VSAN.ID}")].architecture.first()')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Configured witnesses','vsan.cluster.witness.count[{#VSAN.ID}]','vsan.witness.get',pfx+'count','UNSIGNED')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Storage pool collection warning','vsan.cluster.pools.warning[{#VSAN.ID}]','vsan.pools.get',pfx+'warning','TEXT')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: S.M.A.R.T. collection warning','vsan.cluster.smart.warning[{#VSAN.ID}]','vsan.smart.get',pfx+'warning','TEXT')
[['total','Hosts in inventory',"return hs.length;"],['connected','Hosts connected to vCenter',"if(hs.some(function(h){return ['connected','disconnected','notResponding'].indexOf(h.connection)<0;})) throw 'Host connection state unavailable'; return hs.filter(function(h){return h.connection==='connected';}).length;"],['unavailable','Hosts disconnected or not responding',"if(hs.some(function(h){return ['connected','disconnected','notResponding'].indexOf(h.connection)<0;})) throw 'Host connection state unavailable'; return hs.filter(function(h){return h.connection==='disconnected'||h.connection==='notResponding';}).length;"]].each do |field,label,logic|
  p=proto("vSAN [{#VSAN.NAME}]: #{label}","vsan.cluster.hosts.#{field}[{#VSAN.ID}]",'vsan.topology.get','$.topology.hosts','UNSIGNED')
  code="var x=JSON.parse(value); if(x.error || !x.topology) throw 'Topology unavailable'; var hs=x.topology.hosts.filter(function(h){return h.cluster_id==='{#VSAN.ID}';}); "+logic
  p['preprocessing']=[js(code).merge('error_handler'=>'DISCARD_VALUE')]
  cluster_rule['item_prototypes'] << p
end
[['objects','Resync objects',nil],['bytes','Resync remaining bytes','B'],['eta','Resync estimated remaining time','s'],['active_objects','Resync active objects',nil],['queued_objects','Resync queued objects',nil],['suspended_objects','Resync suspended objects',nil],['active_bytes','Resync active bytes','B'],['queued_bytes','Resync queued bytes','B'],['suspended_bytes','Resync suspended bytes','B'],['active_eta','Resync active estimated time','s'],['queued_eta','Resync queued estimated time','s'],['suspended_eta','Resync suspended estimated time','s']].each do |field,name,unit|
  p=proto("vSAN [{#VSAN.NAME}]: #{name}","vsan.cluster.resync.#{field}[{#VSAN.ID}]",'vsan.resync.get',pfx+field,'UNSIGNED',unit)
  if field=='objects'
    metric="/#{NAME}/#{p['key']}"
    high="min(#{metric},{$VSAN.RESYNC.TIME.HIGH})>0 and count(#{metric},{$VSAN.RESYNC.TIME.HIGH})>={$VSAN.RESYNC.SAMPLES.HIGH} and nodata(#{metric},{$VSAN.API.NODATA})=0"
    warn="min(#{metric},{$VSAN.RESYNC.TIME.WARN})>0 and count(#{metric},{$VSAN.RESYNC.TIME.WARN})>={$VSAN.RESYNC.SAMPLES.WARN} and nodata(#{metric},{$VSAN.API.NODATA})=0"
    p['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Resynchronization exceeds high duration',high,'HIGH',{'opdata'=>'Objects: {ITEM.LASTVALUE}'}),trigger('vSAN [{#VSAN.NAME}]: Resynchronization exceeds warning duration',warn,'AVERAGE',{'opdata'=>'Objects: {ITEM.LASTVALUE}','dependencies'=>[{'name'=>'vSAN [{#VSAN.NAME}]: Resynchronization exceeds high duration','expression'=>high}]})]
  end
  cluster_rule['item_prototypes'] << p
end
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Resync metric warning','vsan.cluster.resync.warning[{#VSAN.ID}]','vsan.resync.get',pfx+'warning','TEXT')
[['sampled_objects','Sampled resync objects','UNSIGNED'],['sampled_components','Sampled resync components','UNSIGNED'],['reasons','Sampled resync reasons','TEXT'],['reason_warning','Resync reason sampling warning','TEXT']].each do |field,label,type|
  cluster_rule['item_prototypes'] << proto("vSAN [{#VSAN.NAME}]: #{label}","vsan.cluster.resync.#{field}[{#VSAN.ID}]",'vsan.resync.get',pfx+field,type)
end
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Resync read throughput','vsan.cluster.resync.read_bps[{#VSAN.ID}]','vsan.performance.get',pfx+'resync_read_bps','FLOAT','Bps')
[['iops_read','Read IOPS',nil],['iops_write','Write IOPS',nil],['iops_total','Total IOPS',nil],['throughput_read','Read throughput','Bps'],['throughput_write','Write throughput','Bps'],['throughput_total','Total throughput','Bps'],['latency_read','Read latency','s'],['latency_write','Write latency','s'],['congestion','Congestion',nil],['outstanding_io','Outstanding I/O',nil],['sample_age','Oldest performance sample age','s']].each do |field,name,unit|
  p=proto("vSAN [{#VSAN.NAME}]: #{name}","vsan.cluster.performance.#{field}[{#VSAN.ID}]",'vsan.performance.get',pfx+field,'FLOAT',unit)
  if ['latency_read','latency_write'].include?(field)
    metric="/#{NAME}/#{p['key']}"
    critical="avg(#{metric},{$VSAN.LATENCY.TIME})>{$VSAN.LATENCY.CRIT:\"{#VSAN.ID}\"} and nodata(#{metric},{$VSAN.API.NODATA})=0"
    warning="avg(#{metric},{$VSAN.LATENCY.TIME})>{$VSAN.LATENCY.WARN:\"{#VSAN.ID}\"} and nodata(#{metric},{$VSAN.API.NODATA})=0"
    p['trigger_prototypes']=[trigger("vSAN [{#VSAN.NAME}]: #{name} is critical",critical,'AVERAGE',{'status'=>'DISABLED','description'=>'Disabled until raw latency conversion is checked against vCenter graphs.','opdata'=>'{ITEM.LASTVALUE}'}),trigger("vSAN [{#VSAN.NAME}]: #{name} is high",warning,'WARNING',{'status'=>'DISABLED','description'=>'Disabled until raw latency conversion is checked against vCenter graphs.','opdata'=>'{ITEM.LASTVALUE}','dependencies'=>[{'name'=>"vSAN [{#VSAN.NAME}]: #{name} is critical",'expression'=>critical}]})]
  end
  cluster_rule['item_prototypes'] << p
end
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Performance Service state','vsan.cluster.performance.service[{#VSAN.ID}]','vsan.performance.get',pfx+'service')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Performance metric warning','vsan.cluster.performance.warning[{#VSAN.ID}]','vsan.performance.get',pfx+'warning','TEXT')
cluster_rule['item_prototypes'] << proto('vSAN [{#VSAN.NAME}]: Detailed performance warning','vsan.cluster.performance.detail.warning[{#VSAN.ID}]','vsan.performance.get',pfx+'detail_warning','TEXT')
cluster_rule['graph_prototypes']=[{'uuid'=>uid('graph:capacity'),'name'=>'vSAN [{#VSAN.NAME}]: Capacity','graph_items'=>[['total','1A7C11'],['used','F63100'],['free','2774A4']].map.with_index{|(f,color),i| {'sortorder'=>i.to_s,'color'=>color,'item'=>{'host'=>NAME,'key'=>"vsan.cluster.capacity.#{f}[{#VSAN.ID}]"}}}}]
cluster_rule['graph_prototypes'] << {'uuid'=>uid('graph:resync'),'name'=>'vSAN [{#VSAN.NAME}]: Resync remaining bytes','graph_items'=>[{'color'=>'F63100','item'=>{'host'=>NAME,'key'=>'vsan.cluster.resync.bytes[{#VSAN.ID}]'}}]}
cluster_rule['graph_prototypes'] << {'uuid'=>uid('graph:resync-read'),'name'=>'vSAN [{#VSAN.NAME}]: Resync read throughput','graph_items'=>[{'color'=>'2774A4','item'=>{'host'=>NAME,'key'=>'vsan.cluster.resync.read_bps[{#VSAN.ID}]'}}]}
[['iops','IOPS'],['throughput','Throughput'],['latency','Latency']].each do |prefix,label|
  cluster_rule['graph_prototypes'] << {'uuid'=>uid('graph:performance:'+prefix),'name'=>"vSAN [{#VSAN.NAME}]: #{label}",'graph_items'=>[['read','1A7C11'],['write','F63100']].map.with_index{|(op,color),i|{'sortorder'=>i.to_s,'color'=>color,'item'=>{'host'=>NAME,'key'=>"vsan.cluster.performance.#{prefix}_#{op}[{#VSAN.ID}]"}}}}
end
health_discovery_base=%q~var x=JSON.parse(value); if(x.error) throw x.error; if(x.partial) throw 'Some cluster health summaries are unavailable'; var out=[]; x.clusters.forEach(function(c){var entry=x.data[c.id]; if(!entry||entry.error||!entry.value) throw 'Incomplete health data'; var h=entry.value; if(h.groups.some(function(g){return g.inProgress;})) throw 'A health group is still in progress'; ~
group_js=health_discovery_base + %q~h.groups.forEach(function(g){out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.GROUP.ID}':g.id,'{#VSAN.GROUP.NAME}':g.name});});}); return JSON.stringify(out);~
test_js=health_discovery_base + %q~h.tests.forEach(function(t){out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.GROUP.ID}':t.groupId,'{#VSAN.TEST.ID}':t.id,'{#VSAN.TEST.NAME}':t.name});});}); return JSON.stringify(out);~
rules=[cluster_rule]
category_js=%q~var x=JSON.parse(value); if(x.error||x.partial) throw 'Some capacity reports are unavailable'; var out=[]; x.clusters.forEach(function(c){var e=x.data[c.id]; if(!e||e.error||!e.value||e.value.detail_warning) throw 'Capacity category breakdown is unavailable or incomplete'; e.value.categories.forEach(function(v){out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.CATEGORY.ID}':v.id,'{#VSAN.CATEGORY.TYPE}':v.type});});}); return JSON.stringify(out);~
category_param='{#VSAN.ID},"{#VSAN.CATEGORY.ID}"'; category_path='$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].'
category_items=[]
[['overhead','Redundancy overhead'],['temporary_overhead','Temporary overhead'],['primary','Primary data'],['provisioned','Provisioned capacity'],['reserved','Object policy reserved capacity'],['over_reserved','Over-reserved capacity'],['physical_used','Physical used capacity'],['object_used','Used capacity'],['snapshot_used','Snapshot usage']].each do |f,label|
  category_items << proto("vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] #{label}","vsan.capacity.category.#{f}[#{category_param}]",'vsan.capacity.get',category_path+f+'.first()','UNSIGNED','B')
end
category_items << proto('vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] description',"vsan.capacity.category.description[#{category_param}]",'vsan.capacity.get',category_path+'description.first()','TEXT')
rules << {'uuid'=>uid('lld:capacitycategory'),'name'=>'vSAN capacity category discovery','type'=>'DEPENDENT','key'=>'vsan.capacity.category.discovery','filter'=>{'evaltype'=>'AND','conditions'=>[{'macro'=>'{#VSAN.CATEGORY.TYPE}','value'=>'{$VSAN.CATEGORY.MATCHES}'},{'macro'=>'{#VSAN.CATEGORY.TYPE}','value'=>'{$VSAN.CATEGORY.NOT_MATCHES}','operator'=>'NOT_MATCHES_REGEX'}]},'lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Object type and extension as reported by spaceDetail; invalid, duplicate or missing categories preserve the last discovery.','item_prototypes'=>category_items,'master_item'=>{'key'=>'vsan.capacity.get'},'preprocessing'=>[js(category_js)]}
[['group','Group',group_js,'{#VSAN.GROUP.ID}','{$VSAN.GROUP.MATCHES}'],['test','Test',test_js,'{#VSAN.TEST.ID}','{$VSAN.TEST.MATCHES}']].each do |kind,label,code,macro,filter|
  key="vsan.health.#{kind}.discovery"
  idmacro=kind=='group' ? '{#VSAN.GROUP.ID}' : '{#VSAN.TEST.ID}'
  disp=kind=='group' ? '{#VSAN.GROUP.NAME}' : '{#VSAN.TEST.NAME}'
  path = if kind=='group'; '$.data["{#VSAN.ID}"].value.groups[?(@.id == "{#VSAN.GROUP.ID}")].status.first()'; else '$.data["{#VSAN.ID}"].value.tests[?(@.groupId == "{#VSAN.GROUP.ID}" && @.id == "{#VSAN.TEST.ID}")].status.first()'; end
  param=kind=='group' ? '{#VSAN.ID},"{#VSAN.GROUP.ID}"' : '{#VSAN.ID},"{#VSAN.GROUP.ID}","{#VSAN.TEST.ID}"'
  item=proto("vSAN [{#VSAN.NAME}]: #{label} #{disp} status","vsan.health.#{kind}.status[#{param}]",'vsan.health.get',path)
  item['valuemap']={'name'=>'vSAN health status'}
  if kind=='test'
    item['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Health check {#VSAN.TEST.NAME} is red',"last(/#{NAME}/#{item['key']})=\"red\" and nodata(/#{NAME}/#{item['key']},{$VSAN.API.NODATA})=0",'HIGH',{'opdata'=>'{ITEM.LASTVALUE}','status'=>'DISABLED'})]
  end
  prototypes=[item]
  if kind=='test'
    description_path='$.data["{#VSAN.ID}"].value.tests[?(@.groupId == "{#VSAN.GROUP.ID}" && @.id == "{#VSAN.TEST.ID}")].description.first()'
    prototypes << proto("vSAN [{#VSAN.NAME}]: Test #{disp} description","vsan.health.test.description[#{param}]",'vsan.health.get',description_path,'TEXT')
  end
  not_filter=kind=='group' ? '{$VSAN.GROUP.NOT_MATCHES}' : '{$VSAN.TEST.NOT_MATCHES}'
  rules << {'uuid'=>uid('lld:'+kind),'name'=>"Skyline health #{kind} discovery",'type'=>'DEPENDENT','key'=>key,'filter'=>{'evaltype'=>'AND','conditions'=>[{'macro'=>macro,'value'=>filter},{'macro'=>macro,'value'=>not_filter,'operator'=>'NOT_MATCHES_REGEX'}]},'lifetime'=>'30d','enabled_lifetime'=>'7d','item_prototypes'=>prototypes,'master_item'=>{'key'=>'vsan.health.get'},'preprocessing'=>[js(code)]}
end
object_js=%q~var x=JSON.parse(value); if(x.error) throw x.error; if(x.partial) throw 'Some object health summaries are unavailable'; var out=[]; x.clusters.forEach(function(c){var e=x.data[c.id]; if(!e||e.error||!e.value) throw 'Incomplete object health data'; e.value.states.forEach(function(s){out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.OBJECT.STATE}':s.state,'{#VSAN.OBJECT.SOURCE}':s.source});});}); return JSON.stringify(out);~
object_key='vsan.object.state.count[{#VSAN.ID},"{#VSAN.OBJECT.SOURCE}","{#VSAN.OBJECT.STATE}"]'
object_path='$.data["{#VSAN.ID}"].value.states[?(@.state == "{#VSAN.OBJECT.STATE}" && @.source == "{#VSAN.OBJECT.SOURCE}")].count.first()'
object_proto=proto('vSAN [{#VSAN.NAME}]: Objects in state {#VSAN.OBJECT.STATE} ({#VSAN.OBJECT.SOURCE})',object_key,'vsan.objects.get',object_path,'UNSIGNED')
object_rule={'uuid'=>uid('lld:object'),'name'=>'vSAN object health state discovery','type'=>'DEPENDENT','key'=>'vsan.objects.discovery','lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Aggregated counts from cached objectHealthDetail; no per-object items. An absent state is not assumed to mean zero.','item_prototypes'=>[object_proto],'graph_prototypes'=>[{'uuid'=>uid('graph:object'),'name'=>'vSAN [{#VSAN.NAME}]: Objects {#VSAN.OBJECT.STATE} ({#VSAN.OBJECT.SOURCE})','graph_items'=>[{'color'=>'F63100','item'=>{'host'=>NAME,'key'=>object_key}}]}],'master_item'=>{'key'=>'vsan.objects.get'},'preprocessing'=>[js(object_js)]}
rules << object_rule
inaccessible_key='vsan.object.inaccessible.count[{#VSAN.ID},"{#VSAN.OBJECT.SOURCE}"]'
inaccessible_path='$.data["{#VSAN.ID}"].value.states[?(@.state == "inaccessible" && @.source == "{#VSAN.OBJECT.SOURCE}")].count.first()'
inaccessible_item=proto('vSAN [{#VSAN.NAME}]: Inaccessible objects ({#VSAN.OBJECT.SOURCE})',inaccessible_key,'vsan.objects.get',inaccessible_path,'UNSIGNED')
inaccessible_metric="/#{NAME}/#{inaccessible_key}"
inaccessible_item['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Inaccessible objects ({#VSAN.OBJECT.SOURCE})',"last(#{inaccessible_metric})>0 and nodata(#{inaccessible_metric},{$VSAN.API.NODATA})=0",'DISASTER',{'opdata'=>'Objects: {ITEM.LASTVALUE}','dependencies'=>[{'name'=>'vSAN: Objects collection failed','expression'=>"length(last(/#{NAME}/vsan.objects.error))>0"}]})]
rules << {'uuid'=>uid('lld:inaccessible_objects'),'name'=>'vSAN inaccessible object source discovery','type'=>'DEPENDENT','key'=>'vsan.objects.inaccessible.discovery','filter'=>{'conditions'=>[{'macro'=>'{#VSAN.OBJECT.STATE}','value'=>'^inaccessible$'}]},'lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Only counts explicitly returned as inaccessible; absent categories are never treated as zero. A missing update eventually closes the trigger through nodata.','item_prototypes'=>[inaccessible_item],'master_item'=>{'key'=>'vsan.objects.get'},'preprocessing'=>[js(object_js)]}
disk_js=%q~var x=JSON.parse(value); if(x.error) throw x.error; if(x.partial) throw 'Some disk health summaries are unavailable'; var out=[]; x.clusters.forEach(function(c){var e=x.data[c.id]; if(!e||e.error||!e.value) throw 'Incomplete disk health data'; e.value.disks.forEach(function(d){out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.DISK.ID}':d.id,'{#VSAN.DISK.NAME}':d.name,'{#VSAN.DISK.HOST}':d.host});});}); return JSON.stringify(out);~
disk_rule={'uuid'=>uid('lld:disk'),'name'=>'vSAN physical disk discovery','type'=>'DEPENDENT','key'=>'vsan.disk.discovery','filter'=>{'evaltype'=>'AND','conditions'=>[{'macro'=>'{#VSAN.DISK.NAME}','value'=>'{$VSAN.DISK.MATCHES}'},{'macro'=>'{#VSAN.DISK.NAME}','value'=>'{$VSAN.DISK.NOT_MATCHES}','operator'=>'NOT_MATCHES_REGEX'}]},'lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Disk UUID and health from cached Skyline result. Failed or stale collection does not produce an empty discovery.','item_prototypes'=>[],'master_item'=>{'key'=>'vsan.disks.get'},'preprocessing'=>[js(disk_js)]}
disk_param='{#VSAN.ID},"{#VSAN.DISK.ID}"'
disk_path='$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].'
[['health','Disk health','CHAR',nil],['operational_health','Disk operational health','CHAR',nil],['operational_description','Disk operational health description','TEXT',nil],['metadata_health','Disk metadata health','CHAR',nil],['capacity_health','Disk capacity health','CHAR',nil],['capacity','Disk capacity','UNSIGNED','B'],['used_capacity','Disk used capacity','UNSIGNED','B'],['reserved_capacity','Disk reserved capacity','UNSIGNED','B'],['congestion','Disk congestion','UNSIGNED',nil],['vendor','Disk vendor','CHAR',nil],['model','Disk model','CHAR',nil],['firmware','Disk firmware','CHAR',nil],['serial','Disk serial number','CHAR',nil],['ssd','Disk SSD flag','CHAR',nil],['disk_group_uuid','Disk group UUID','CHAR',nil]].each do |f,label,type,unit|
  source=%w[capacity vendor model firmware serial ssd].include?(f) ? 'vsan.diskmeta.get' : 'vsan.disks.get'
  p=proto("vSAN [{#VSAN.NAME}]: #{label} [{#VSAN.DISK.NAME}]","vsan.disk.#{f}[#{disk_param}]",source,disk_path+f+'.first()',type,unit)
  if f=='health'
    p['valuemap']={'name'=>'vSAN health status'}
    expr="count(/#{NAME}/#{p['key']},70m,\"eq\",\"red\")>=2 and nodata(/#{NAME}/#{p['key']},{$VSAN.API.NODATA})=0"
    p['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] is unhealthy',expr,'HIGH',{'opdata'=>'{ITEM.LASTVALUE}','dependencies'=>[{'name'=>'vSAN: Disks collection failed','expression'=>"length(last(/#{NAME}/vsan.disks.error))>0"}]})]
  end
  disk_rule['item_prototypes'] << p
end
disk_rule['graph_prototypes']=[{'uuid'=>uid('graph:diskcongestion'),'name'=>'vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] congestion','graph_items'=>[{'color'=>'F63100','item'=>{'host'=>NAME,'key'=>"vsan.disk.congestion[#{disk_param}]"}}]}]
smart_path='$.data["{#VSAN.ID}"].value.disks[?(@.host == "{#VSAN.DISK.HOST}" && @.name == "{#VSAN.DISK.NAME}")].'
[['health','S.M.A.R.T. health code'],['wear_raw','S.M.A.R.T. media wearout indicator raw'],['temperature_raw','S.M.A.R.T. temperature raw'],['read_errors_raw','S.M.A.R.T. read error count raw'],['write_errors_raw','S.M.A.R.T. write error count raw']].each do |f,label|
  p=proto("vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] #{label}","vsan.disk.smart.#{f}[#{disk_param}]",'vsan.smart.get',smart_path+f+'.first()','UNSIGNED')
  if f=='health'
    p['valuemap']={'name'=>'vSAN S.M.A.R.T. health'}
    metric="/#{NAME}/#{p['key']}"
    failure="count(#{metric},25m,\"eq\",\"2\")>=2 and nodata(#{metric},{$VSAN.API.NODATA})=0"
    warning="count(#{metric},25m,\"eq\",\"1\")>=2 and nodata(#{metric},{$VSAN.API.NODATA})=0"
    failure_name='vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] S.M.A.R.T. impending failure'
    p['trigger_prototypes']=[trigger(failure_name,failure,'HIGH',{'opdata'=>'{ITEM.LASTVALUE}','dependencies'=>[{'name'=>'vSAN: Smart collection failed','expression'=>"length(last(/#{NAME}/vsan.smart.error))>0"}]}),trigger('vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] S.M.A.R.T. warning',warning,'WARNING',{'opdata'=>'{ITEM.LASTVALUE}','dependencies'=>[{'name'=>failure_name,'expression'=>failure}]})]
  elsif f=='wear_raw'
    metric="/#{NAME}/#{p['key']}"
    low="last(#{metric})<{$VSAN.DISK.ENDURANCE.WARN} and nodata(#{metric},{$VSAN.API.NODATA})=0"
    critical="last(#{metric})<{$VSAN.DISK.ENDURANCE.CRIT} and nodata(#{metric},{$VSAN.API.NODATA})=0"
    critical_name='vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] raw wear indicator critical'
    details={'status'=>'DISABLED','description'=>'Disabled by default: validate the vendor-specific meaning of this raw S.M.A.R.T. value before enabling.','opdata'=>'Raw: {ITEM.LASTVALUE}'}
    p['trigger_prototypes']=[trigger(critical_name,critical,'AVERAGE',details),trigger('vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] raw wear indicator low',low,'WARNING',details.merge('dependencies'=>[{'name'=>critical_name,'expression'=>critical}]))]
  end
  disk_rule['item_prototypes'] << p
end
smart_warning=proto('vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] S.M.A.R.T. warning',"vsan.disk.smart.warning[#{disk_param}]",'vsan.smart.get',smart_path+'warning.first()','TEXT')
smart_warning['preprocessing'][0]['error_handler']='CUSTOM_VALUE'
smart_warning['preprocessing'][0]['error_handler_params']='S.M.A.R.T. disk result not available or host/disk name not matched'
disk_rule['item_prototypes'] << smart_warning
disk_rule['graph_prototypes'] << {'uuid'=>uid('graph:diskwear'),'name'=>'vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] raw wearout indicator','graph_items'=>[{'color'=>'F63100','item'=>{'host'=>NAME,'key'=>"vsan.disk.smart.wear_raw[#{disk_param}]"}}]}
disk_perf_path='$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].'
[['iops_read','Read IOPS',nil],['iops_write','Write IOPS',nil],['iops_total','Total IOPS',nil],['throughput_read','Read throughput','Bps'],['throughput_write','Write throughput','Bps'],['throughput_total','Total throughput','Bps'],['latency_read','Read latency','s'],['latency_write','Write latency','s']].each do |field,label,unit|
  disk_rule['item_prototypes'] << proto("vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] #{label}","vsan.disk.performance.#{field}[#{disk_param}]",'vsan.performance.get',disk_perf_path+field+'.first()','FLOAT',unit)
end
disk_perf_warning=proto('vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] performance warning',"vsan.disk.performance.warning[#{disk_param}]",'vsan.performance.get',disk_perf_path+'warning.first()','TEXT')
disk_perf_warning['preprocessing'][0]['error_handler']='CUSTOM_VALUE'; disk_perf_warning['preprocessing'][0]['error_handler_params']='Disk performance unavailable or disk role/UUID not mapped'
disk_rule['item_prototypes'] << disk_perf_warning
disk_rule['graph_prototypes'] << {'uuid'=>uid('graph:disk-performance'),'name'=>'vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] IOPS','graph_items'=>[['iops_read','1A7C11'],['iops_write','F63100']].map.with_index{|(f,color),i|{'sortorder'=>i.to_s,'color'=>color,'item'=>{'host'=>NAME,'key'=>"vsan.disk.performance.#{f}[#{disk_param}]"}}}}
rules << disk_rule
diskgroup_js=%q~var x=JSON.parse(value); if(x.error) throw x.error; if(x.partial) throw 'Some disk health summaries are unavailable'; var out=[]; x.clusters.forEach(function(c){var e=x.data[c.id], seen={}; if(!e||e.error||!e.value) throw 'Incomplete disk health data'; if(c.architecture!=='OSA') return; e.value.disks.forEach(function(d){if(d.disk_group_uuid && !seen[d.disk_group_uuid]){seen[d.disk_group_uuid]=true; out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.DG.ID}':d.disk_group_uuid});}});}); return JSON.stringify(out);~
dg_key='vsan.diskgroup.disks[{#VSAN.ID},"{#VSAN.DG.ID}"]'
dg_path='$.data["{#VSAN.ID}"].value.disks[?(@.disk_group_uuid == "{#VSAN.DG.ID}")].length()'
dg_rule={'uuid'=>uid('lld:diskgroup'),'name'=>'vSAN OSA disk group discovery','type'=>'DEPENDENT','key'=>'vsan.diskgroup.discovery','lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'OSA disk groups with UUID reported by cached disk health. Missing group identity is not inferred from disk name.','item_prototypes'=>[proto('vSAN [{#VSAN.NAME}]: Disks in disk group [{#VSAN.DG.ID}]',dg_key,'vsan.disks.get',dg_path,'UNSIGNED')],'master_item'=>{'key'=>'vsan.disks.get'},'preprocessing'=>[js(diskgroup_js)]}
rules << dg_rule
host_js=%q~var x=JSON.parse(value); if(x.error||!x.topology) throw 'Topology unavailable'; return JSON.stringify(x.topology.hosts.filter(function(h){return !!h.cluster_id;}).map(function(h){return {'{#VSAN.ID}':h.cluster_id,'{#VSAN.NAME}':h.cluster_name,'{#VSAN.HOST.ID}':h.id,'{#VSAN.HOST.NAME}':h.name};}));~
host_rule={'uuid'=>uid('lld:host'),'name'=>'vSAN host discovery','type'=>'DEPENDENT','key'=>'vsan.host.discovery','filter'=>{'evaltype'=>'AND','conditions'=>[{'macro'=>'{#VSAN.HOST.NAME}','value'=>'{$VSAN.HOST.MATCHES}'},{'macro'=>'{#VSAN.HOST.NAME}','value'=>'{$VSAN.HOST.NOT_MATCHES}','operator'=>'NOT_MATCHES_REGEX'}]},'lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Hosts belonging to vSAN-enabled vCenter clusters, identified by HostSystem MoID. A host may itself have vSAN disabled.','item_prototypes'=>[],'master_item'=>{'key'=>'vsan.topology.get'},'preprocessing'=>[js(host_js)]}
host_param='{#VSAN.ID},"{#VSAN.HOST.ID}"'; host_path='$.topology.hosts[?(@.id == "{#VSAN.HOST.ID}")].'
[['connection','Connection to vCenter'],['vsan_enabled','vSAN enabled'],['fault_domain','Configured fault domain'],['node_uuid','vSAN node UUID']].each do |f,label|
  p=proto("vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] #{label}","vsan.host.#{f}[#{host_param}]",'vsan.topology.get',host_path+f+'.first()')
  if f=='connection'
    metric="/#{NAME}/#{p['key']}"
    expr="(last(#{metric})=\"disconnected\" or last(#{metric})=\"notResponding\") and nodata(#{metric},{$VSAN.API.NODATA})=0"
    p['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] is unavailable',expr,'AVERAGE',{'opdata'=>'{ITEM.LASTVALUE}','dependencies'=>[{'name'=>'vSAN: Topology collection failed','expression'=>"length(last(/#{NAME}/vsan.topology.error))>0"}]})]
  end
  host_rule['item_prototypes'] << p
end
host_perf_path='$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].'
[['iops_read','Read IOPS',nil],['iops_write','Write IOPS',nil],['iops_total','Total IOPS',nil],['throughput_read','Read throughput','Bps'],['throughput_write','Write throughput','Bps'],['throughput_total','Total throughput','Bps'],['latency_read','Read latency','s'],['latency_write','Write latency','s'],['congestion','Congestion',nil],['outstanding_io','Outstanding I/O',nil]].each do |field,label,unit|
  host_rule['item_prototypes'] << proto("vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] #{label}","vsan.host.performance.#{field}[#{host_param}]",'vsan.performance.get',host_perf_path+field+'.first()','FLOAT',unit)
end
host_perf_warning=proto('vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] performance warning',"vsan.host.performance.warning[#{host_param}]",'vsan.performance.get',host_perf_path+'warning.first()','TEXT')
host_perf_warning['preprocessing'][0]['error_handler']='CUSTOM_VALUE'; host_perf_warning['preprocessing'][0]['error_handler_params']='Host performance unavailable or vSAN node UUID not mapped'
host_rule['item_prototypes'] << host_perf_warning
host_rule['graph_prototypes']=[{'uuid'=>uid('graph:host-performance'),'name'=>'vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] IOPS','graph_items'=>[['iops_read','1A7C11'],['iops_write','F63100']].map.with_index{|(f,color),i|{'sortorder'=>i.to_s,'color'=>color,'item'=>{'host'=>NAME,'key'=>"vsan.host.performance.#{f}[#{host_param}]"}}}}]
rules << host_rule
vm_js=%q~var x=JSON.parse(value); if(x.error) throw x.error; var out=[]; x.clusters.forEach(function(c){var e=x.data[c.id]; if(!e) throw 'VM performance result unavailable'; if(e.error) throw e.error; if(!e.value) throw 'VM performance result incomplete'; if(e.value.service==='disabled') return; if(!Array.isArray(e.value.vms)) throw 'VM performance capability unavailable'; e.value.vms.forEach(function(v){if(!v.id||!v.name) return; out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.VM.ID}':v.id,'{#VSAN.VM.NAME}':v.name});});}); return JSON.stringify(out);~
vm_rule={'uuid'=>uid('lld:vm-performance'),'name'=>'vSAN virtual machine performance discovery','type'=>'DEPENDENT','key'=>'vsan.vm.discovery','filter'=>{'evaltype'=>'AND','conditions'=>[{'macro'=>'{#VSAN.VM.NAME}','value'=>'{$VSAN.VM.MATCHES}'},{'macro'=>'{#VSAN.VM.NAME}','value'=>'{$VSAN.VM.NOT_MATCHES}','operator'=>'NOT_MATCHES_REGEX'}]},'lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Discovers VMs whose inventory datastore list includes a vSAN datastore, then queries only counters advertised for virtual-machine entities. Performance Service remains read-only and is never enabled automatically.','item_prototypes'=>[],'master_item'=>{'key'=>'vsan.performance.get'},'preprocessing'=>[js(vm_js)]}
vm_param='{#VSAN.ID},"{#VSAN.VM.ID}"'; vm_perf_path='$.data["{#VSAN.ID}"].value.vms[?(@.id == "{#VSAN.VM.ID}")].'
[['iops_read','Read IOPS',nil],['iops_write','Write IOPS',nil],['iops_total','Total IOPS',nil],['throughput_read','Read throughput','Bps'],['throughput_write','Write throughput','Bps'],['throughput_total','Total throughput','Bps'],['latency_read','Read latency','s'],['latency_write','Write latency','s']].each do |field,label,unit|
  vm_rule['item_prototypes'] << proto("vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] #{label}","vsan.vm.performance.#{field}[#{vm_param}]",'vsan.performance.get',vm_perf_path+field+'.first()','FLOAT',unit)
end
vm_warning=proto('vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] performance warning',"vsan.vm.performance.warning[#{vm_param}]",'vsan.performance.get',vm_perf_path+'warning.first()','TEXT')
vm_warning['preprocessing'][0]['error_handler']='CUSTOM_VALUE'; vm_warning['preprocessing'][0]['error_handler_params']='Per-VM performance unavailable; check Performance Service, API capabilities and permissions'
vm_rule['item_prototypes'] << vm_warning
vm_rule['graph_prototypes']=[
  {'uuid'=>uid('graph:vm-iops'),'name'=>'vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] IOPS','graph_items'=>[['iops_read','1A7C11'],['iops_write','F63100']].map.with_index{|(f,color),i|{'sortorder'=>i.to_s,'color'=>color,'item'=>{'host'=>NAME,'key'=>"vsan.vm.performance.#{f}[#{vm_param}]"}}}},
  {'uuid'=>uid('graph:vm-latency'),'name'=>'vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] latency','graph_items'=>[['latency_read','1A7C11'],['latency_write','F63100']].map.with_index{|(f,color),i|{'sortorder'=>i.to_s,'color'=>color,'item'=>{'host'=>NAME,'key'=>"vsan.vm.performance.#{f}[#{vm_param}]"}}}}
]
rules << vm_rule
ds_js=%q~var x=JSON.parse(value); if(x.error||!x.topology) throw 'Topology unavailable'; return JSON.stringify(x.topology.datastores.map(function(d){return {'{#VSAN.ID}':d.cluster_id,'{#VSAN.NAME}':d.cluster_name,'{#VSAN.DATASTORE.ID}':d.id,'{#VSAN.DATASTORE.NAME}':d.name};}));~
ds_key='vsan.datastore.accessible[{#VSAN.ID},"{#VSAN.DATASTORE.ID}"]'
ds_item=proto('vSAN [{#VSAN.NAME}]: Datastore [{#VSAN.DATASTORE.NAME}] accessible',ds_key,'vsan.topology.get','$.topology.datastores[?(@.id == "{#VSAN.DATASTORE.ID}" && @.cluster_id == "{#VSAN.ID}")].accessible.first()')
ds_item['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Datastore [{#VSAN.DATASTORE.NAME}] is unavailable',"last(/#{NAME}/#{ds_key})=\"false\" and nodata(/#{NAME}/#{ds_key},{$VSAN.API.NODATA})=0",'DISASTER',{'opdata'=>'{ITEM.LASTVALUE}','dependencies'=>[{'name'=>'vSAN: Topology collection failed','expression'=>"length(last(/#{NAME}/vsan.topology.error))>0"}]})]
ds_rule={'uuid'=>uid('lld:datastore'),'name'=>'vSAN datastore discovery','type'=>'DEPENDENT','key'=>'vsan.datastore.discovery','filter'=>{'evaltype'=>'AND','conditions'=>[{'macro'=>'{#VSAN.DATASTORE.NAME}','value'=>'{$VSAN.DATASTORE.MATCHES}'},{'macro'=>'{#VSAN.DATASTORE.NAME}','value'=>'{$VSAN.DATASTORE.NOT_MATCHES}','operator'=>'NOT_MATCHES_REGEX'}]},'lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Datastore accessibility as aggregated by vCenter, not individual host mount availability.','item_prototypes'=>[ds_item],'master_item'=>{'key'=>'vsan.topology.get'},'preprocessing'=>[js(ds_js)]}
rules << ds_rule
witness_js=%q~var x=JSON.parse(value); if(x.error||x.partial) throw 'Some witness configurations are unavailable'; var out=[]; x.clusters.forEach(function(c){var e=x.data[c.id]; if(!e||e.error||!e.value) throw 'Incomplete witness data'; e.value.witnesses.forEach(function(w){out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.WITNESS.ID}':w.id,'{#VSAN.WITNESS.HOST.ID}':w.host_id});});}); return JSON.stringify(out);~
witness_param='{#VSAN.ID},"{#VSAN.WITNESS.ID}"'; witness_path='$.data["{#VSAN.ID}"].value.witnesses[?(@.id == "{#VSAN.WITNESS.ID}")].'
witness_rule={'uuid'=>uid('lld:witness'),'name'=>'vSAN witness host discovery','type'=>'DEPENDENT','key'=>'vsan.witness.discovery','lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Witness UUID and optional HostSystem reference from VSANVcGetWitnessHosts. API errors do not produce an empty list.','item_prototypes'=>[],'master_item'=>{'key'=>'vsan.witness.get'},'preprocessing'=>[js(witness_js)]}
[['host_id','Host reference'],['fault_domain','Witness fault domain'],['preferred_domain','Preferred fault domain'],['preferred_domain_uuid','Preferred fault domain UUID'],['unicast_address','Witness unicast address']].each do |f,label|
  witness_rule['item_prototypes'] << proto("vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] #{label}","vsan.witness.#{f}[#{witness_param}]",'vsan.witness.get',witness_path+f+'.first()')
end
witness_connection=proto('vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] connection to vCenter',"vsan.witness.connection[#{witness_param}]",'vsan.topology.get','$.topology.hosts[?(@.id == "{#VSAN.WITNESS.HOST.ID}")].connection.first()')
wm="/#{NAME}/#{witness_connection['key']}"; wexpr="(last(#{wm})=\"disconnected\" or last(#{wm})=\"notResponding\") and nodata(#{wm},{$VSAN.API.NODATA})=0"
witness_connection['trigger_prototypes']=[trigger('vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] is unavailable',wexpr,'HIGH',{'opdata'=>'{ITEM.LASTVALUE}','dependencies'=>[{'name'=>'vSAN: Topology collection failed','expression'=>"length(last(/#{NAME}/vsan.topology.error))>0"}]})]
witness_rule['item_prototypes'] << witness_connection
witness_warning=proto('vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] inventory warning',"vsan.witness.inventory.warning[#{witness_param}]",'vsan.topology.get','$.topology.hosts','TEXT')
witness_warning['preprocessing']=[js(%q~var x=JSON.parse(value); if(x.error||!x.topology) throw 'Topology unavailable'; var id='{#VSAN.WITNESS.HOST.ID}'; if(id==='unavailable') return 'Witness host reference was not returned'; return x.topology.hosts.some(function(h){return h.id===id;}) ? '' : 'Witness host not visible in vCenter inventory';~).merge('error_handler'=>'DISCARD_VALUE')]
witness_rule['item_prototypes'] << witness_warning
rules << witness_rule
fd_js=%q~var x=JSON.parse(value); if(x.error||x.partial) throw 'Some witness configurations are unavailable'; var out=[]; x.clusters.forEach(function(c){var e=x.data[c.id], seen={}; if(!e||e.error||!e.value) throw 'Incomplete witness data'; e.value.witnesses.forEach(function(w){if(!w.preferred_domain_uuid) return; var id=w.preferred_domain_uuid, name=w.preferred_domain||id; if(seen[id] && seen[id]!==name) throw 'Conflicting preferred fault domain names'; if(!seen[id]) {seen[id]=name; out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.FD.ID}':id,'{#VSAN.FD.NAME}':name});}});}); return JSON.stringify(out);~
fd_key='vsan.faultdomain.preferred.name[{#VSAN.ID},"{#VSAN.FD.ID}"]'
fd_item=proto('vSAN [{#VSAN.NAME}]: Preferred fault domain [{#VSAN.FD.NAME}]',fd_key,'vsan.witness.get','$.data["{#VSAN.ID}"].value.witnesses[?(@.preferred_domain_uuid == "{#VSAN.FD.ID}")].preferred_domain.first()')
fd_rule={'uuid'=>uid('lld:preferred_faultdomain'),'name'=>'vSAN preferred fault domain discovery','type'=>'DEPENDENT','key'=>'vsan.faultdomain.preferred.discovery','lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'Discovers only preferred stretched-cluster fault domains for which the witness API provides a stable UUID; this is not a complete fault domain inventory.','item_prototypes'=>[fd_item],'master_item'=>{'key'=>'vsan.witness.get'},'preprocessing'=>[js(fd_js)]}
rules << fd_rule
pool_js=%q~var x=JSON.parse(value); if(x.error||x.partial) throw 'Some storage pool information is unavailable'; var out=[]; x.clusters.forEach(function(c){var e=x.data[c.id]; if(!e||e.error||!e.value) throw 'Incomplete storage pool data'; e.value.pools.forEach(function(p){out.push({'{#VSAN.ID}':c.id,'{#VSAN.NAME}':c.name,'{#VSAN.POOL.HOST.ID}':p.host_id,'{#VSAN.POOL.HOST.NAME}':p.host_name});});}); return JSON.stringify(out);~
pool_param='{#VSAN.ID},"{#VSAN.POOL.HOST.ID}"'; pool_path='$.data["{#VSAN.ID}"].value.pools[?(@.host_id == "{#VSAN.POOL.HOST.ID}")].'
pool_rule={'uuid'=>uid('lld:storagepool'),'name'=>'vSAN ESA storage pool discovery','type'=>'DEPENDENT','key'=>'vsan.pool.discovery','filter'=>{'evaltype'=>'AND','conditions'=>[{'macro'=>'{#VSAN.POOL.HOST.NAME}','value'=>'{$VSAN.HOST.MATCHES}'},{'macro'=>'{#VSAN.POOL.HOST.NAME}','value'=>'{$VSAN.HOST.NOT_MATCHES}','operator'=>'NOT_MATCHES_REGEX'}]},'lifetime'=>'30d','enabled_lifetime'=>'7d','description'=>'A unique host MoID identifies a host with exactly one reported ESA storage pool. The API pool structure does not expose an independent pool UUID; multiple pools are treated as unavailable.','item_prototypes'=>[proto('vSAN [{#VSAN.NAME}]: Storage pool disk count [{#VSAN.POOL.HOST.NAME}]',"vsan.pool.disks[#{pool_param}]",'vsan.pools.get',pool_path+'disk_count.first()','UNSIGNED'),proto('vSAN [{#VSAN.NAME}]: Storage pool warning [{#VSAN.POOL.HOST.NAME}]',"vsan.pool.warning[#{pool_param}]",'vsan.pools.get',pool_path+'warning.first()','TEXT')],'master_item'=>{'key'=>'vsan.pools.get'},'preprocessing'=>[js(pool_js)]}
rules << pool_rule
rules.each do |rule|
  rule['lifetime_type']='DELETE_AFTER'
  rule['enabled_lifetime_type']='DISABLE_AFTER'
  unless ['vsan.inventory.get','vsan.topology.get'].include?(rule['master_item']['key'])
    rule['preprocessing'][0]['parameters'][0]="if(JSON.parse(value).disabled) throw 'Monitoring category disabled'; "+rule['preprocessing'][0]['parameters'][0]
  end
end
macros=[['{$VSAN.URL}','https://vcenter.example.com'],['{$VSAN.USERNAME}',''],['{$VSAN.PASSWORD}',''],['{$VSAN.HTTP.PROXY}',''],['{$VSAN.TIMEOUT}','60s'],['{$VSAN.INTERVAL.INVENTORY}','1h'],['{$VSAN.INTERVAL.HEALTH}','10m'],['{$VSAN.INTERVAL.CAPACITY}','30m'],['{$VSAN.INTERVAL.OBJECTS}','15m'],['{$VSAN.INTERVAL.RESYNC}','5m'],['{$VSAN.INTERVAL.DISKS}','30m'],['{$VSAN.INTERVAL.PERFORMANCE}','10m'],['{$VSAN.API.NODATA}','45m'],['{$VSAN.API.NODATA.METADATA}','26h'],['{$VSAN.DISKMETA.MAX.AGE}','172800'],['{$VSAN.HEALTH.MAX.AGE}','3600'],['{$VSAN.PERF.MAX.AGE}','900'],['{$VSAN.CAPACITY.WARN}','75'],['{$VSAN.CAPACITY.HIGH}','85'],['{$VSAN.CAPACITY.CRIT}','95'],['{$VSAN.LATENCY.WARN}','0.015'],['{$VSAN.LATENCY.CRIT}','0.030'],['{$VSAN.LATENCY.TIME}','5m'],['{$VSAN.RESYNC.TIME.WARN}','4h'],['{$VSAN.RESYNC.TIME.HIGH}','24h'],['{$VSAN.RESYNC.SAMPLES.WARN}','200'],['{$VSAN.RESYNC.SAMPLES.HIGH}','1200'],['{$VSAN.CLUSTER.MATCHES}','.*'],['{$VSAN.CLUSTER.NOT_MATCHES}','CHANGE_IF_NEEDED'],['{$VSAN.GROUP.MATCHES}','.*'],['{$VSAN.GROUP.NOT_MATCHES}','CHANGE_IF_NEEDED'],['{$VSAN.TEST.MATCHES}','.*'],['{$VSAN.TEST.NOT_MATCHES}','CHANGE_IF_NEEDED'],['{$VSAN.DISK.MATCHES}','.*'],['{$VSAN.DISK.NOT_MATCHES}','CHANGE_IF_NEEDED']].map do |name,v|
  h={'macro'=>name,'value'=>v}; h['type']='SECRET_TEXT' if name=='{$VSAN.PASSWORD}'; h
end
[['{$VSAN.INTERVAL.TOPOLOGY}','10m'],['{$VSAN.INTERVAL.WITNESS}','30m'],['{$VSAN.INTERVAL.POOLS}','1h'],['{$VSAN.INTERVAL.SMART}','30m'],['{$VSAN.INTERVAL.DISKMETA}','1d'],['{$VSAN.API.NODATA.SLOW}','2h'],['{$VSAN.HOST.MATCHES}','.*'],['{$VSAN.HOST.NOT_MATCHES}','CHANGE_IF_NEEDED'],['{$VSAN.DATASTORE.MATCHES}','.*'],['{$VSAN.DATASTORE.NOT_MATCHES}','CHANGE_IF_NEEDED']].each{|name,value|macros << {'macro'=>name,'value'=>value}}
[['{$VSAN.VM.MATCHES}','.*'],['{$VSAN.VM.NOT_MATCHES}','CHANGE_IF_NEEDED']].each{|name,value|macros << {'macro'=>name,'value'=>value}}
%w[health capacity objects resync disks diskmeta performance witness pools smart].each{|mode|macros << {'macro'=>"{$VSAN.#{mode.upcase}.ENABLED}",'value'=>'1'}}
[['{$VSAN.DISK.ENDURANCE.WARN}','20'],['{$VSAN.DISK.ENDURANCE.CRIT}','10']].each{|name,value|macros << {'macro'=>name,'value'=>value}}
[['{$VSAN.CATEGORY.MATCHES}','.*'],['{$VSAN.CATEGORY.NOT_MATCHES}','CHANGE_IF_NEEDED']].each{|name,value|macros << {'macro'=>name,'value'=>value}}
dashboards=[['vSAN Overview','Cluster capacity','vsan.cluster.capacity.used[{#VSAN.ID}]'],['vSAN Capacity','Cluster capacity','vsan.cluster.capacity.used[{#VSAN.ID}]'],['vSAN Performance','Cluster latency','vsan.cluster.performance.latency_read[{#VSAN.ID}]'],['vSAN Object Health','Object health',object_key],['vSAN Resynchronization','Resync remaining bytes','vsan.cluster.resync.bytes[{#VSAN.ID}]'],['vSAN Physical Disks','Disk congestion',"vsan.disk.congestion[#{disk_param}]"]].map do |name,widget,key|
  {'uuid'=>uid('dashboard:'+name),'name'=>name,'pages'=>[{'name'=>name,'widgets'=>[{'type'=>'graphprototype','name'=>widget,'width'=>'72','height'=>'8','fields'=>[{'type'=>'INTEGER','name'=>'columns','value'=>'1'},{'type'=>'ITEM_PROTOTYPE','name'=>'itemid.0','value'=>{'host'=>NAME,'key'=>key}},{'type'=>'STRING','name'=>'reference','value'=>'VSANA'},{'type'=>'INTEGER','name'=>'source_type','value'=>'3'}]}]}]}
end
dashboards << {'uuid'=>uid('dashboard:skyline'),'name'=>'vSAN Skyline Health','pages'=>[{'name'=>'Collection status','widgets'=>[{'type'=>'itemhistory','name'=>'Skyline collection status','width'=>'72','height'=>'8','fields'=>[{'type'=>'STRING','name'=>'columns.0.name','value'=>'Collection error'},{'type'=>'ITEM','name'=>'columns.0.itemid','value'=>{'host'=>NAME,'key'=>'vsan.health.error'}},{'type'=>'STRING','name'=>'columns.1.name','value'=>'Clusters with errors'},{'type'=>'ITEM','name'=>'columns.1.itemid','value'=>{'host'=>NAME,'key'=>'vsan.health.partial'}}]}]}]}
valuemaps=[{'uuid'=>uid('valuemap:health'),'name'=>'vSAN health status','mappings'=>[['green','Green'],['yellow','Yellow'],['red','Red'],['unknown','Unknown'],['info','Information'],['stale','Cache stale'],['in_progress','In progress'],['unavailable','Unavailable']].map{|x|{'value'=>x[0],'newvalue'=>x[1]}}}, {'uuid'=>uid('valuemap:smart'),'name'=>'vSAN S.M.A.R.T. health','mappings'=>[['0','OK'],['1','Warning'],['2','Impending failure'],['3','Unknown']].map{|x|{'value'=>x[0],'newvalue'=>x[1]}}}]
template={'uuid'=>uid('template'),'template'=>NAME,'name'=>NAME,'description'=>'Experimental: vSAN inventory, cached Skyline health, capacity, disks, performance, topology and resync. Read project documentation before deployment.','groups'=>[{'name'=>'Templates/Applications'}],'items'=>items,'discovery_rules'=>rules,'macros'=>macros,'dashboards'=>dashboards,'valuemaps'=>valuemaps}
export={'zabbix_export'=>{'version'=>'8.0','template_groups'=>[{'uuid'=>'a571c0d144b14fd4a87a9d9b2aa9fcd6','name'=>'Templates/Applications'}],'templates'=>[template]}}
File.write(File.join(ROOT,'template_vmware_vsan_http.yaml'), YAML.dump(export, line_width: -1))
puts "Built #{items.length} items, #{rules.length} LLD rules, #{rules.sum{|x|x['item_prototypes'].size}} prototypes"
