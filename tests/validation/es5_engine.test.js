/* Run the real collector in MuJS, an ES5 interpreter. This is not Zabbix/Duktape. */
var fs=require('fs'),path=require('path'),cp=require('child_process');
var source=fs.readFileSync(path.join(__dirname,'../../src/collector.js'),'utf8');
var harness=String.raw`
function HttpRequest() { this.status=200; }
HttpRequest.prototype.clearHeader=function(){};
HttpRequest.prototype.addHeader=function(){};
HttpRequest.prototype.setProxy=function(){};
HttpRequest.prototype.getStatus=function(){return this.status;};
HttpRequest.prototype.getHeaders=function(){return {'Set-Cookie':['vmware_soap_session="session"; Path=/sdk']};};
HttpRequest.prototype.get=function(){return JSON.stringify({namespaces:{namespace:{name:'urn:vsan',version:'8.0.0.3'}}});};
function envelope(op, data){var b={}; b[op+'Response']={returnval:data};return JSON.stringify({'soapenv:Envelope':{'soapenv:Body':b}});}
HttpRequest.prototype.post=function(url, body){
 var op=/<soapenv:Body><([A-Za-z]+)\s/.exec(body)[1], x={};
 if(op==='RetrieveServiceContent')x={sessionManager:'SessionManager',viewManager:'ViewManager',propertyCollector:'propertyCollector',rootFolder:'group-d1'};
 else if(op==='CreateContainerView')x='view-1';
 else if(op==='RetrievePropertiesEx')x={objects:{obj:{'@type':'ClusterComputeResource','#text':'domain-c1'},propSet:[{name:'name',val:'cluster'},{name:'configurationEx',val:{vsanConfigInfo:{enabled:'true',vsanEsaEnabled:'false',defaultConfig:{uuid:'11111111-1111-1111-1111-111111111111'}}}}]}};
 else if(op==='VsanQuerySpaceUsage')x={totalCapacityB:'18014398509481985',freeCapacityB:'18014398509481984',spaceOverview:{snapshotUsedB:'1'}};
 else if(op==='VsanClusterGetConfig')x={perfsvcConfig:{enabled:'true'}};
 else if(op==='VsanPerfGetSupportedEntityTypes')x={name:'cluster-domclient',graphs:[{unit:'number',metrics:[{label:'iopsRead',group:'domclient'},{label:'iopsWrite',group:'domclient'}]},{unit:'time_ms',metrics:[{label:'latencyAvgRead',group:'domclient'}]}]};
 else if(op==='VsanPerfQueryPerf')x={entityRefId:'cluster-domclient:11111111-1111-1111-1111-111111111111',sampleInfo:new Date().toISOString(),value:[{metricId:{label:'iopsRead'},values:'100'},{metricId:{label:'iopsWrite'},values:'20'},{metricId:{label:'latencyAvgRead'},values:'10'}]};
 return envelope(op,x);
};
var XML={toJson:function(x){return x;}}, Zabbix={log:function(){}};
function run(mode) { var value=JSON.stringify({url:'https://vc.example.org',username:'name',password:'pass',mode:mode,max_age:'3600',perf_max_age:'900',enabled:'1',proxy:''}); return JSON.parse((function(value){
`+source+String.raw`
})(value)); }
var c=run('capacity'), p=run('performance');
if(c.error || c.data['domain-c1'].value.used!=='1')throw new Error('capacity in ES5 engine failed '+JSON.stringify(c));
if(p.error || p.data['domain-c1'].value.iops_total!==120 || Math.abs(p.data['domain-c1'].value.latency_read-0.00001)>1e-12)throw new Error('performance in ES5 engine failed '+JSON.stringify(p));
print('MuJS ES5 execution: capacity and performance synthetic flow: OK (not Zabbix/Duktape)');
`;
var f=path.join(require('os').tmpdir(),'vsan-mujs-'+process.pid+'.js');
try {fs.writeFileSync(f,harness); cp.execFileSync('mujs',[f],{stdio:'inherit'});} finally {try{fs.unlinkSync(f);}catch(e){}}
