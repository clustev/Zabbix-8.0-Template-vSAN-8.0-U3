/* Synthetic Zabbix XML.toJson and HTTP mocks, not recordings from vCenter. */
var fs=require('fs'), vm=require('vm'), assert=require('assert'), path=require('path'), child=require('child_process');
var source=fs.readFileSync(path.join(__dirname,'../../src/collector.js'),'utf8');
function envelope(op, result) { var body={}; body[op+'Response']=result===undefined?{}:{returnval:result}; return JSON.stringify({'soapenv:Envelope':{'soapenv:Body':body}}); }
function obj(id,name,esa) {return {obj:{'@type':'ClusterComputeResource','#text':id},propSet:[{name:'name',val:name},{name:'configurationEx',val:{vsanConfigInfo:{enabled:'true',vsanEsaEnabled:esa,defaultConfig:{uuid:id==='domain-c1'?'11111111-1111-1111-1111-111111111111':'22222222-2222-2222-2222-222222222222'}},vsanHostConfig:{hostSystem:{'#text':id==='domain-c1'?'host-1':'host-2'},clusterInfo:{nodeUuid:'node-'+id},storageInfo:{diskMapping:{ssd:{vsanDiskInfo:{vsanUuid:'cache-123'}},nonSsd:{vsanDiskInfo:{vsanUuid:'disk-123'}}}}}}}]};}
function run(mode, options) {
 options=options||{}; var calls=[], warnings=[], currentStatus=200, lastOp='', optionsSeen, output;
 function Request(tls){optionsSeen=tls;this.headers=[];}
 Request.prototype.clearHeader=function(){this.headers=[];};
 Request.prototype.addHeader=function(h){this.headers.push(h);};
 Request.prototype.setProxy=function(){};
 Request.prototype.getStatus=function(){return currentStatus;};
 Request.prototype.getHeaders=function(){return {'Set-Cookie':['vmware_soap_session="secret-token"; Path=/sdk; HttpOnly']};};
 Request.prototype.get=function(url){calls.push({op:'GetVersion',url:url,headers:this.headers.slice()}); currentStatus=200; if(options.badVersion) return 'invalid-json'; return JSON.stringify({namespaces:{namespace:{name:'urn:vsan',version:'8.0.0.3'}}});};
 Request.prototype.post=function(url,body){
  var match=/<soapenv:Body><([A-Za-z]+)\s/.exec(body); assert(match,body); var op=match[1]; lastOp=op; currentStatus=200;
  child.execFileSync('xmllint',['--noout','-'],{input:body,stdio:['pipe','pipe','pipe']});
  calls.push({op:op,url:url,body:body,headers:this.headers.slice()});
  if(options.failOp===op){currentStatus=options.status||403;return 'failure';}
  if(options.permissionOp===op){currentStatus=500;return JSON.stringify({'soapenv:Envelope':{'soapenv:Body':{'soapenv:Fault':{detail:{NoPermissionFault:{privilegeId:'System.Read',object:{'#text':'group-d1'}}}}}}});}
  if(options.faultOp===op) return JSON.stringify({'soapenv:Envelope':{'soapenv:Body':{'soapenv:Fault':{faultstring:'synthetic error'}}}});
  if(op==='RetrieveServiceContent')return envelope(op,{sessionManager:{'#text':'SessionManager'},viewManager:{'#text':'ViewManager'},propertyCollector:{'#text':'propertyCollector'},rootFolder:{'#text':'group-d1'}});
  if(op==='Login'||op==='Logout'||op==='DestroyView')return envelope(op,{});
  if(op==='CreateContainerView')return envelope(op,{'#text':'view-1'});
  if(op==='RetrievePropertiesEx'){
   if(body.includes('<type>HostSystem</type>')) {
    var rows=[{obj:{'@type':'HostSystem','#text':'host-1'},propSet:[{name:'name',val:'esx-1'},{name:'parent',val:{'#text':'domain-c1'}},{name:'runtime.connectionState',val:'connected'},{name:'config.vsanHostConfig.enabled',val:'true'},{name:'config.vsanHostConfig.faultDomainInfo',val:{name:'FD-A'}},{name:'config.vsanHostConfig.clusterInfo',val:{nodeUuid:'node-1'}}]},{obj:{'@type':'Datastore','#text':'datastore-1'},propSet:[{name:'summary',val:{name:'vsan-ds',type:'vsan',accessible:'true'}}]}];
    if(!options.missingHost)rows.push({obj:{'@type':'HostSystem','#text':'host-2'},propSet:[{name:'name',val:'esx-2'},{name:'parent',val:{'#text':'domain-c2'}},{name:'runtime.connectionState',val:options.hostDown?'disconnected':'connected'}]});
    return envelope(op,{objects:rows});
   }
   var clusterObj=obj('domain-c1','One','false');
   if(mode==='topology')clusterObj.propSet.push({name:'datastore',val:{ManagedObjectReference:{'#text':'datastore-1'}}});
   return envelope(op,{objects:clusterObj,token:'next-page'});
  }
  if(op==='ContinueRetrievePropertiesEx')return envelope(op,{objects:obj('domain-c2','Two','true')});
  if(op==='VsanQueryVcClusterHealthSummary'){
   assert(url.endsWith('/vsanHealth')); assert(this.headers.some(function(h){return h==='Cookie: vmware_soap_session="secret-token"';}));
   assert(body.includes('<fetchFromCache>true</fetchFromCache>')); assert(body.includes('<includeObjUuids>false</includeObjUuids>'));
   if(options.partial && body.includes('domain-c2')){currentStatus=403;return '';}
   if(body.includes('<fields>physicalDisksHealth</fields>')) return envelope(op,{timestamp:options.stale?'2020-01-01T00:00:00Z':new Date().toISOString(),physicalDisksHealth:options.noDisks?undefined:{hostname:'host.example',error:options.diskError?{localizedMessage:'synthetic error'}:undefined,disks:[{name:'naa.123',uuid:'disk-123',summaryHealth:'red',operationalHealth:'red',capacity:'1024',vsanDiskGroupUuid:'group-123',scsiDisk:{vendor:'VENDOR',model:'MODEL',ssd:'true'}}]}});
   if(body.includes('<fields>objectHealth</fields>')) return envelope(op,{timestamp:options.stale?'2020-01-01T00:00:00Z':new Date().toISOString(),objectHealth:options.noObjects?{}:{objectHealthDetail:[{health:'healthy',numObjects:'10'},{health:'inaccessible',numObjects:'1',vsanClusterUuid:'uuid-2'}]}});
   return envelope(op,{timestamp:options.stale?'2020-01-01T00:00:00Z':new Date().toISOString(),overallHealth:'red',networkHealth:{issueFound:'true',partitions:[{},{}]},groups:{groupId:'g',groupName:'Group',groupHealth:'red',groupTests:[{testId:'t1',testName:'Check',testHealth:'red'},{testId:'t2'}]}});
  }
  if(op==='VsanQuerySpaceUsage')return envelope(op,{totalCapacityB:'18014398509481985',freeCapacityB:options.noFree?undefined:'18014398509481984',spaceOverview:options.noOverview?undefined:{overheadB:'9',physicalUsedB:'18014398509481983',snapshotUsedB:'0'},spaceDetail:options.noDetail?undefined:{spaceUsageByObjectType:options.duplicateCategory?[{objType:'vdisk'},{objType:'vdisk'}]:[{objType:'vdisk',usedB:'123'},{objType:'extension',objTypeExt:'ext-1',physicalUsedB:'10'}]}});
  if(op==='QuerySyncingVsanObjectsSummary'){assert(body.includes('<numberOfObjects>100</numberOfObjects>'));return envelope(op,{totalObjectsToSync:'2',totalBytesToSync:'1048576',totalRecoveryETA:'3600',objects:{uuid:'object-1',components:[{reasons:['repair','stale']},{reasons:['repair']}]},syncingObjectRecoveryDetails:{activeObjectsToSync:'1',queuedObjectsToSync:'1'}});}
  if(op==='VsanQueryVcClusterSmartStatsSummary')return envelope(op,{hostname:'host.example',smartStats:{disk:'naa.123',error:options.smartError?{localizedMessage:'error'}:undefined,stats:[{parameter:'smarthealthstatus',value:options.smartInvalid?'8':'2'},{parameter:'smartmediawearoutindicator',value:'7'},{parameter:'smartreaderrorcount',value:'3'}]}});
  if(op==='VsanClusterGetConfig')return envelope(op,{perfsvcConfig:{enabled:options.perfDisabled?'false':'true'}});
  if(op==='VSANVcGetWitnessHosts')return envelope(op,body.includes('domain-c1')?{nodeUuid:'witness-uuid-1',host:{'@type':'HostSystem','#text':'host-wit'},faultDomainName:'Witness FD',preferredFdUuid:'fd-uuid-1'}:undefined);
  if(op==='QueryVsanManagedDisks')return envelope(op,{storagePools:options.twoPools?[{storagePoolDisks:[{},{}]},{storagePoolDisks:{}}]:{storagePoolDisks:[{},{}]}});
  if(op==='VsanPerfGetSupportedEntityTypes'){assert(!body.includes('<cluster '));return envelope(op,[{name:'cluster-domclient',graphs:[{unit:'number',metrics:[{label:'iopsRead',group:'domclient'},{label:'iopsWrite',group:'domclient'}]},{unit:'rate_bytes',metrics:[{label:'throughputRead',group:'domclient'}]},{unit:options.badUnit?'unknown':'time_ms',metrics:[{label:'latencyAvgRead',group:'domclient'}]}]},{name:'cluster-domcompmgr',graphs:{unit:'rate_bytes',metrics:{label:'tputResyncRead'}}},{name:'host-domclient',graphs:{unit:'number',metrics:[{label:'iopsRead'},{label:'iopsWrite'}]}},{name:'capacity-disk',graphs:{unit:'number',metrics:[{label:'iopsDevRead'},{label:'iopsDevWrite'}]}},{name:'cache-disk',graphs:{unit:'number',metrics:[{label:'iopsDevRead'},{label:'iopsDevWrite'}]}}]);}
  if(op==='VsanPerfQueryPerf'){
   var uuid=body.includes('11111111-1111')?'11111111-1111-1111-1111-111111111111':'22222222-2222-2222-2222-222222222222';
   var stamp=options.perfStale?'2020-01-01T00:00:00Z':new Date().toISOString();
   if(options.perfSpaceTimestamp && !options.perfStale)stamp=stamp.slice(0,19).replace('T',' ');
   if(body.includes('cluster-domcompmgr:'))return envelope(op,{entityRefId:'cluster-domcompmgr:'+uuid,sampleInfo:stamp,value:{metricId:{label:'tputResyncRead'},values:'1234'}});
   if(body.includes('host-domclient:') || body.includes('capacity-disk:') || body.includes('cache-disk:')){
    var refs=Array.from(body.matchAll(/<entityRefId>([^<]+)<\/entityRefId>/g),function(m){return m[1];});
    return envelope(op,refs.map(function(ref){var disk=ref.indexOf('-disk:')>=0; return {entityRefId:ref,sampleInfo:stamp,value:[{metricId:{label:disk?'iopsDevRead':'iopsRead'},values:'11'},{metricId:{label:disk?'iopsDevWrite':'iopsWrite'},values:'22'}]};}));
   }
   return envelope(op,{entityRefId:'cluster-domclient:'+uuid,sampleInfo:stamp,value:[{metricId:{label:'iopsRead',group:'domclient'},values:'100'},{metricId:{label:'iopsWrite',group:'domclient'},values:'50'},{metricId:{label:'throughputRead',group:'domclient'},values:'1048576'},{metricId:{label:'latencyAvgRead',group:'domclient'},values:'20'}]});
  }
  throw new Error('Unexpected operation '+op);
 };
 var context={value:JSON.stringify({url:'https://vc.example.org',username:'name<&',password:'pass<&',mode:mode,max_age:'3600',perf_max_age:'900',enabled:options.disabled?'0':'1',proxy:''}),HttpRequest:Request,XML:{toJson:function(body){return body;}},Zabbix:{log:function(level,msg){warnings.push(msg);}}};
 output=JSON.parse(vm.runInNewContext('(function(value){'+source+'})(value)',context));
 return {output:output,calls:calls,tls:optionsSeen,warnings:warnings};
}
var a=run('inventory');
assert.strictEqual(a.output.error,''); assert.strictEqual(a.output.clusters.length,2); assert.strictEqual(a.output.clusters[0].architecture,'OSA'); assert.strictEqual(a.output.clusters[1].architecture,'ESA');
assert.strictEqual(a.tls.SSLVerifyPeer,true); assert.strictEqual(a.tls.SSLVerifyHost,true); assert(a.calls.some(function(x){return x.op==='ContinueRetrievePropertiesEx';}));
var login=a.calls.filter(function(x){return x.op==='Login';})[0]; assert(login.body.includes('name&lt;&amp;')); assert(login.body.includes('pass&lt;&amp;')); assert(!JSON.stringify(a.output).includes('pass'));
assert.deepStrictEqual(a.calls.slice(-2).map(function(x){return x.op;}),['DestroyView','Logout']);
var h=run('health'); assert.strictEqual(h.output.error,''); assert.strictEqual(h.output.partial,0); assert.strictEqual(h.output.data['domain-c1'].value.status,'red'); assert.strictEqual(h.output.data['domain-c1'].value.tests[1].status,'unavailable');
assert.strictEqual(h.output.data['domain-c1'].value.network_issue,1); assert.strictEqual(h.output.data['domain-c1'].value.network_partitions,2);
assert.strictEqual(h.calls.filter(function(x){return x.op==='VsanQueryVcClusterHealthSummary';}).length,2);
var partial=run('health',{partial:true}); assert.strictEqual(partial.output.partial,1); assert.strictEqual(partial.output.data['domain-c2'].error,'HTTP 403 during VsanQueryVcClusterHealthSummary'); assert.strictEqual(partial.output.data['domain-c1'].value.status,'red');
var stale=run('health',{stale:true}); assert.strictEqual(stale.output.data['domain-c1'].value.status,'stale'); assert.strictEqual(stale.output.data['domain-c1'].value.tests[0].status,'stale'); assert.strictEqual(stale.output.data['domain-c1'].value.cache_error,'Health cache is stale');
assert(!('network_issue' in stale.output.data['domain-c1'].value));
var cap=run('capacity'); assert.strictEqual(cap.output.data['domain-c1'].value.used,'1');
assert.strictEqual(cap.output.data['domain-c1'].value.physical_used,'18014398509481983'); assert.strictEqual(cap.output.data['domain-c1'].value.snapshot_used,'0'); assert(cap.output.data['domain-c1'].value.overview_warning.includes('primaryCapacityB'));
assert.strictEqual(cap.output.data['domain-c1'].value.categories[0].id,'vdisk|'); assert.strictEqual(cap.output.data['domain-c1'].value.categories[0].object_used,'123'); assert.strictEqual(cap.output.data['domain-c1'].value.categories[1].id,'extension|ext-1');
var noDetail=run('capacity',{noDetail:true}); assert(noDetail.output.data['domain-c1'].value.detail_warning.includes('unavailable')); assert.strictEqual(noDetail.output.data['domain-c1'].value.used,'1');
var dupCategory=run('capacity',{duplicateCategory:true}); assert(dupCategory.output.data['domain-c1'].value.detail_warning.includes('duplicate'));
var noOverview=run('capacity',{noOverview:true}); assert(!('overhead' in noOverview.output.data['domain-c1'].value)); assert(noOverview.output.data['domain-c1'].value.overview_warning.includes('overheadB'));
var nofree=run('capacity',{noFree:true}); assert(!('used' in nofree.output.data['domain-c1'].value)); assert(nofree.output.data['domain-c1'].value.warning.includes('Free capacity'));
var objects=run('objects'); assert.strictEqual(objects.output.partial,0); assert.strictEqual(objects.output.data['domain-c1'].value.states[1].state,'inaccessible'); assert.strictEqual(objects.output.data['domain-c1'].value.states[1].count,'1');
var noObjects=run('objects',{noObjects:true}); assert.strictEqual(noObjects.output.partial,2); assert(noObjects.output.data['domain-c1'].error.includes('unavailable or empty'));
var staleObjects=run('objects',{stale:true}); assert.strictEqual(staleObjects.output.partial,2); assert(staleObjects.output.data['domain-c1'].error.includes('stale'));
var sync=run('resync'); assert.strictEqual(sync.output.partial,0); assert.strictEqual(sync.output.data['domain-c1'].value.objects,'2'); assert.strictEqual(sync.output.data['domain-c1'].value.bytes,'1048576'); assert(!('active_bytes' in sync.output.data['domain-c1'].value)); assert(sync.output.data['domain-c1'].value.warning.includes('bytesToSyncForActiveObjects'));
assert.strictEqual(sync.output.data['domain-c1'].value.reasons,'repair: 2, stale: 1'); assert.strictEqual(sync.output.data['domain-c1'].value.sampled_components,2); assert(sync.output.data['domain-c1'].value.reason_warning.includes('at most 100'));
var disks=run('disks'); assert.strictEqual(disks.output.partial,0); assert.strictEqual(disks.output.data['domain-c1'].value.disks[0].id,'disk-123'); assert.strictEqual(disks.output.data['domain-c1'].value.disks[0].health,'red'); assert(!('serial' in disks.output.data['domain-c1'].value.disks[0]));
var diskError=run('disks',{diskError:true}); assert.strictEqual(diskError.output.partial,2); assert(diskError.output.data['domain-c1'].error.includes('failed on a host'));
var noDisks=run('disks',{noDisks:true}); assert.strictEqual(noDisks.output.partial,2);
var staleDisks=run('disks',{stale:true}); assert.strictEqual(staleDisks.output.partial,2); assert(staleDisks.output.data['domain-c1'].error.includes('stale'));
var perf=run('performance'); assert.strictEqual(perf.output.partial,0); assert.strictEqual(perf.output.data['domain-c1'].value.iops_total,150); assert(Math.abs(perf.output.data['domain-c1'].value.latency_read-0.00002)<1e-12); assert.strictEqual(perf.output.data['domain-c1'].value.throughput_read,1048576); assert(!('throughput_total' in perf.output.data['domain-c1'].value));
assert.strictEqual(perf.output.data['domain-c1'].value.resync_read_bps,1234); assert.strictEqual(perf.output.data['domain-c1'].value.hosts[0].iops_total,33); assert.strictEqual(perf.output.data['domain-c1'].value.disks.length,2); assert.strictEqual(perf.output.data['domain-c1'].value.disks[0].iops_total,33);
var timeFmt=run('performance',{perfSpaceTimestamp:true}); assert.strictEqual(timeFmt.output.data['domain-c1'].value.iops_total,150); assert.strictEqual(timeFmt.output.data['domain-c1'].value.resync_read_bps,1234);
var off=run('performance',{perfDisabled:true}); assert.strictEqual(off.output.data['domain-c1'].value.service,'disabled'); assert(off.output.data['domain-c1'].value.warning.includes('disabled')); assert(!off.calls.some(function(x){return x.op==='VsanPerfQueryPerf';}));
var disabled=run('performance',{disabled:true}); assert.strictEqual(disabled.output.state,'disabled by macro'); assert.strictEqual(disabled.output.disabled,true); assert.strictEqual(disabled.calls.length,0);
var badunit=run('performance',{badUnit:true}); assert(!('latency_read' in badunit.output.data['domain-c1'].value)); assert(badunit.output.data['domain-c1'].value.warning.includes('unsupported or ambiguous unit'));
var stalePerf=run('performance',{perfStale:true}); assert(!('iops_read' in stalePerf.output.data['domain-c1'].value)); assert(stalePerf.output.data['domain-c1'].value.warning.includes('no current sample'));
var topology=run('topology'); assert.strictEqual(topology.output.error,''); assert.strictEqual(topology.output.topology.hosts[0].cluster_id,'domain-c1'); assert.strictEqual(topology.output.topology.hosts[0].fault_domain,'FD-A'); assert.strictEqual(topology.output.topology.datastores[0].accessible,'true'); assert.deepStrictEqual(topology.calls.slice(-3).map(function(x){return x.op;}),['DestroyView','DestroyView','Logout']);
var incompleteTopology=run('topology',{missingHost:true}); assert(incompleteTopology.output.error.includes('No hosts visible')); assert(!incompleteTopology.output.topology);
var witness=run('witness'); assert.strictEqual(witness.output.data['domain-c1'].value.witnesses[0].id,'witness-uuid-1'); assert.strictEqual(witness.output.data['domain-c1'].value.witnesses[0].host_id,'host-wit'); assert.strictEqual(witness.output.data['domain-c2'].value.count,0);
var pools=run('pools'); assert.strictEqual(pools.output.partial,0); assert.strictEqual(pools.output.data['domain-c2'].value.pools[0].disk_count,2); assert(pools.output.data['domain-c1'].value.warning.includes('not applicable'));
var twoPools=run('pools',{twoPools:true}); assert.strictEqual(twoPools.output.partial,1); assert(twoPools.output.data['domain-c2'].value.warning.includes('cannot be uniquely identified'));
var downHost=run('pools',{hostDown:true}); assert.strictEqual(downHost.output.partial,1); assert(downHost.output.data['domain-c2'].value.warning.includes('not connected'));
var smart=run('smart'); assert.strictEqual(smart.output.data['domain-c1'].value.disks[0].health,'2'); assert.strictEqual(smart.output.data['domain-c1'].value.disks[0].wear_raw,'7'); assert(smart.output.data['domain-c1'].value.disks[0].warning.includes('temperature_raw'));
var invalidSmart=run('smart',{smartInvalid:true}); assert(!('health' in invalidSmart.output.data['domain-c1'].value.disks[0]));
var smartError=run('smart',{smartError:true}); assert(smartError.output.data['domain-c1'].value.disks[0].warning.includes('query failed')); assert(!('wear_raw' in smartError.output.data['domain-c1'].value.disks[0]));
var bad=run('health',{failOp:'Login',status:401}); assert.strictEqual(bad.output.error,'HTTP 401 during Login'); assert(!bad.calls.some(function(x){return x.op==='Logout';}));
var denied=run('performance',{permissionOp:'VsanPerfGetSupportedEntityTypes'}); assert(denied.output.data['domain-c1'].error.includes('NoPermission: System.Read on group-d1'));
assert.strictEqual(bad.output.availability_error,'HTTP 401 during Login'); assert.strictEqual(topology.output.availability_error,'');
var version=run('health',{badVersion:true}); assert(version.output.error.includes('Invalid XML')); assert.deepStrictEqual(version.calls.slice(-2).map(function(x){return x.op;}),['DestroyView','Logout']);
var fault=run('health',{faultOp:'VsanQueryVcClusterHealthSummary'}); assert.strictEqual(fault.output.partial,2); assert(fault.output.data['domain-c1'].error.includes('SOAP Fault'));
console.log('collector: inventory, pagination, two architectures, cached health, partial failures, stale data, capacity and session cleanup: OK');
