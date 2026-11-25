/* Synthetic SOAP/XML and a documented-serialization approximation, NOT zabbix_js. */
var fs=require('fs'),vm=require('vm'),assert=require('assert'),cp=require('child_process'),path=require('path');
var source=fs.readFileSync(path.join(__dirname,'../../src/collector.js'),'utf8'), code=path.join(__dirname,'xml_adapter.py');
var calls=[],status=200;
function env(op,body){return '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><'+op+'Response xmlns="urn:vim25">'+(body===null?'':'<returnval>'+body+'</returnval>')+'</'+op+'Response></soapenv:Body></soapenv:Envelope>';}
function Req(opts){assert(opts.SSLVerifyPeer && opts.SSLVerifyHost);this.headers=[];}
Req.prototype.clearHeader=function(){this.headers=[];}; Req.prototype.addHeader=function(x){this.headers.push(x);}; Req.prototype.getStatus=function(){return status;};
Req.prototype.getHeaders=function(){return {'set-cookie':['vmware_soap_session="fake"; Path=/sdk; HttpOnly']};}; Req.prototype.setProxy=function(){};
Req.prototype.get=function(){return '<namespaces version="1.0"><namespace><name>urn:vsan</name><version>8.0.0.3</version></namespace></namespaces>';};
Req.prototype.post=function(url,body){var op=/<soapenv:Body><([A-Za-z]+)\s/.exec(body)[1]; calls.push(op);
 if(op==='RetrieveServiceContent') return env(op,'<sessionManager type="SessionManager">SessionManager</sessionManager><viewManager type="ViewManager">ViewManager</viewManager><propertyCollector type="PropertyCollector">propertyCollector</propertyCollector><rootFolder type="Folder">group-d1</rootFolder>');
 if(op==='Login'||op==='Logout'||op==='DestroyView')return env(op,null);
 if(op==='CreateContainerView')return env(op,'view-1');
 if(op==='RetrievePropertiesEx')return env(op,'<objects><obj type="ClusterComputeResource">domain-c42</obj><propSet><name>name</name><val>Example &amp; SAN</val></propSet><propSet><name>configurationEx</name><val xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ClusterConfigInfoEx"><vsanConfigInfo><enabled>true</enabled><vsanEsaEnabled>true</vsanEsaEnabled></vsanConfigInfo></val></propSet></objects>');
 if(op==='VsanQueryVcClusterHealthSummary')return fs.readFileSync(path.join(__dirname,'../fixtures/skyline-synthetic.xml'),'utf8').replace('__TIMESTAMP__',new Date().toISOString());
 throw new Error('Unexpected '+op);
};
var ctx={value:JSON.stringify({url:'https://vc.example.org',username:'demo',password:'demo',mode:'health',max_age:'3600',perf_max_age:'900',enabled:'1'}),HttpRequest:Req,XML:{toJson:function(xml){return cp.execFileSync('python3',[code],{input:xml,encoding:'utf8'});}}};
var result=JSON.parse(vm.runInNewContext('(function(value){'+source+'})(value)',ctx));
assert.strictEqual(result.error,''); assert.strictEqual(result.clusters[0].name,'Example & SAN'); assert.strictEqual(result.clusters[0].architecture,'ESA');
assert.strictEqual(result.data['domain-c42'].value.tests[0].status,'red'); assert.deepStrictEqual(calls.slice(-2),['DestroyView','Logout']);
console.log('Synthetic SOAP/XML flow passed via XML serialization approximation.');
