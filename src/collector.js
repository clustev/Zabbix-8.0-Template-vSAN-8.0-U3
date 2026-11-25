/* Zabbix Script item source. Build embeds this file into each master item. */
var input = JSON.parse(value), mode = input.mode, req, svc, viewId = null, extraViews = [], authenticated = false, sessionCookie = null;
var output = {error: '', availability_error: 'Not checked', state: 'enabled', disabled: false, clusters: [], data: {}, version: '', partial: 0};
function fail(s) { throw new Error(s); }
function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function list(x) { return x === undefined || x === null ? [] : (Array.isArray(x) ? x : [x]); }
function field(o, name) {
    if (!o || typeof o !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(o, name)) return o[name];
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k) && k.charAt(0) !== '@' && k.split(':').pop() === name) return o[k];
    return undefined;
}
function txt(o) {
    if (o === null || o === undefined) return null;
    if (typeof o === 'object') return typeof o['#text'] === 'string' ? o['#text'] : null;
    return String(o);
}
function xmljson(body) {
    var x;
    try { x = XML.toJson(body); return typeof x === 'string' ? JSON.parse(x) : x; }
    catch (e) { fail('Invalid XML response or XML support unavailable'); }
}
function soapFault(body) {
    try {
        var xml=xmljson(body), fault=field(field(field(xml,'Envelope'),'Body'),'Fault'), detail=field(fault,'detail');
        if (!fault) return '';
        var denied=field(detail,'NoPermissionFault'), privilege=txt(field(denied,'privilegeId')), obj=txt(field(denied,'object'));
        if (denied && privilege && /^[A-Za-z0-9_.-]+$/.test(privilege)) return 'SOAP NoPermission: ' + privilege + (obj && /^[A-Za-z0-9_.:-]+$/.test(obj) ? ' on ' + obj : '');
        return 'SOAP Fault';
    } catch (ignore) { return ''; }
}
function call(endpoint, ns, action, body, op) {
    req.clearHeader();
    req.addHeader('Content-Type: text/xml; charset=utf-8');
    req.addHeader('SOAPAction: "' + action + '"');
    if (endpoint === '/vsanHealth' && sessionCookie) req.addHeader('Cookie: ' + sessionCookie);
    var envelope = '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><' + op + ' xmlns="' + ns + '">' + body + '</' + op + '></soapenv:Body></soapenv:Envelope>';
    var raw;
    try { raw = req.post(input.url + endpoint, envelope); }
    catch (e) { fail('HTTP transport or TLS failure during ' + op); }
    var status = req.getStatus();
    if (status !== 200) { var fault = typeof raw === 'string' ? soapFault(raw) : ''; fail((fault || 'HTTP ' + status) + ' during ' + op); }
    if (typeof raw !== 'string' || raw.length > 8 * 1024 * 1024) fail('Invalid or oversized response during ' + op);
    var root = xmljson(raw), env = field(root, 'Envelope'), soapBody = field(env, 'Body');
    if (!soapBody) fail('Invalid SOAP envelope during ' + op);
    if (field(soapBody, 'Fault')) fail('SOAP Fault during ' + op);
    var reply = field(soapBody, op + 'Response');
    if (reply === undefined) fail('Invalid SOAP response during ' + op);
    return field(reply, 'returnval');
}
function mo(type, id) { return '<_this type="' + type + '">' + escapeXml(id) + '</_this>'; }
function vim(op, body) { return call('/sdk', 'urn:vim25', 'urn:vim25/8.0.3.0', body, op); }
function vsan(op, body) { return call('/vsanHealth', 'urn:vsan', 'urn:vsan/' + output.version, body, op); }
function serviceVersion() {
    var raw;
    try { raw = req.get(input.url + '/sdk/vsanServiceVersions.xml'); } catch (e) { fail('vSAN API version discovery transport or TLS failure'); }
    if (req.getStatus() !== 200) fail('HTTP ' + req.getStatus() + ' during vSAN API version discovery');
    if (typeof raw !== 'string' || raw.length > 1024 * 1024) fail('Invalid or oversized version response');
    var root = field(xmljson(raw), 'namespaces'), namespaces = list(field(root, 'namespace'));
    for (var i = 0; i < namespaces.length; i++) {
        if (txt(field(namespaces[i], 'name')) === 'urn:vsan') {
            var ver = txt(field(namespaces[i], 'version'));
            if (ver && /^[0-9]+(?:\.[0-9]+){1,3}$/.test(ver)) return ver;
            var prior = list(field(field(namespaces[i], 'priorVersions'), 'version'));
            for (var j = 0; j < prior.length; j++) {
                ver = txt(prior[j]);
                if (ver && /^[0-9]+(?:\.[0-9]+){1,3}$/.test(ver)) return ver;
            }
        }
    }
    fail('No supported numeric vSAN API version advertised');
}
function inventory() {
    var c = vim('RetrieveServiceContent', mo('ServiceInstance', 'ServiceInstance'));
    svc = {session: txt(field(c, 'sessionManager')), view: txt(field(c, 'viewManager')),
        collector: txt(field(c, 'propertyCollector')), root: txt(field(c, 'rootFolder'))};
    if (!svc.session || !svc.view || !svc.collector || !svc.root) fail('ServiceContent missing required references');
    vim('Login', mo('SessionManager', svc.session) + '<userName>' + escapeXml(input.username) + '</userName><password>' + escapeXml(input.password) + '</password>');
    authenticated = true;
    output.availability_error = '';
    var headers = req.getHeaders(true), cookieHeaders = [];
    for (var header in headers) if (Object.prototype.hasOwnProperty.call(headers, header) && header.toLowerCase() === 'set-cookie') cookieHeaders = list(headers[header]);
    cookieHeaders.forEach(function (h) {
        var match = /^\s*(vmware_soap_session=(?:"[^"\r\n]*"|[^;\s\r\n]+))/i.exec(String(h));
        if (match) sessionCookie = match[1];
    });
    if (!sessionCookie) fail('Login response did not include the VMware SOAP session cookie');
    var view = vim('CreateContainerView', mo('ViewManager', svc.view) + '<container type="Folder">' + escapeXml(svc.root) + '</container><type>ClusterComputeResource</type><recursive>true</recursive>');
    viewId = txt(view);
    if (!viewId) fail('CreateContainerView returned no reference');
    var body = mo('PropertyCollector', svc.collector) + '<specSet><propSet><type>ClusterComputeResource</type><all>false</all><pathSet>name</pathSet><pathSet>configurationEx</pathSet>' + (mode === 'topology' || mode === 'performance' ? '<pathSet>datastore</pathSet>' : '') + '</propSet>' +
        '<objectSet><obj type="ContainerView">' + escapeXml(viewId) + '</obj><skip>true</skip><selectSet xsi:type="TraversalSpec"><name>view</name><type>ContainerView</type><path>view</path><skip>false</skip></selectSet></objectSet></specSet><options><maxObjects>100</maxObjects></options>';
    var page = vim('RetrievePropertiesEx', body), pages = 0, clusters = [];
    while (page) {
        if (++pages > 100) fail('Inventory exceeded page limit');
        list(field(page, 'objects')).forEach(function (obj) {
            if (list(field(obj, 'missingSet')).length) fail('Inventory has missing properties; check permissions');
            var id = txt(field(obj, 'obj')), name = null, config = null, fullConfig = null, datastoreRefs = [];
            list(field(obj, 'propSet')).forEach(function (p) {
                var key = txt(field(p, 'name'));
                if (key === 'name') name = txt(field(p, 'val'));
                if (key === 'configurationEx') { fullConfig = field(p, 'val'); config = field(fullConfig, 'vsanConfigInfo'); }
                if (key === 'datastore') datastoreRefs = referenceIds(field(p, 'val'));
            });
            if (!id || !name) fail('Incomplete cluster inventory');
            if (!/^[A-Za-z0-9_.:-]+$/.test(id)) fail('Unexpected cluster managed object ID');
            if (txt(field(config, 'enabled')) === 'true') {
                var esa = txt(field(config, 'vsanEsaEnabled'));
                var uuid = txt(field(field(config, 'defaultConfig'), 'uuid'));
                if (uuid && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid)) uuid = null;
                var cluster = {id: id, name: name, architecture: esa === 'true' ? 'ESA' : (esa === 'false' ? 'OSA' : 'unknown'), uuid: uuid};
                if (mode === 'topology' || mode === 'performance') cluster.datastore_ids = datastoreRefs;
                if (mode === 'performance') {
                    cluster.perf_hosts = []; cluster.perf_disks = []; cluster.perf_vms = []; cluster.perf_vm_warning = '';
                    list(field(fullConfig, 'vsanHostConfig')).forEach(function(h) {
                        var hostId = txt(field(h, 'hostSystem')), node = txt(field(field(h, 'clusterInfo'), 'nodeUuid'));
                        if (hostId && node && /^[A-Za-z0-9_.:-]+$/.test(hostId) && /^[A-Za-z0-9_.:-]+$/.test(node)) cluster.perf_hosts.push({id:hostId, uuid:node});
                        if (cluster.architecture !== 'OSA') return;
                        list(field(field(h, 'storageInfo'), 'diskMapping')).forEach(function(mapping) {
                            [['ssd','cache-disk'],['nonSsd','capacity-disk']].forEach(function(pair) {
                                list(field(mapping, pair[0])).forEach(function(disk) {
                                    var diskId = txt(field(field(disk, 'vsanDiskInfo'), 'vsanUuid'));
                                    if (diskId && /^[A-Za-z0-9_.:-]+$/.test(diskId)) cluster.perf_disks.push({id:diskId, type:pair[1]});
                                });
                            });
                        });
                    });
                }
                clusters.push(cluster);
                if (clusters.length > 500) fail('Inventory exceeded 500 vSAN clusters');
            }
        });
        var token = txt(field(page, 'token'));
        if (!token) break;
        page = vim('ContinueRetrievePropertiesEx', mo('PropertyCollector', svc.collector) + '<token>' + escapeXml(token) + '</token>');
        if (!page) fail('Empty continuation response');
    }
    if (mode === 'performance') collectPerformanceVmInventory(clusters);
    return clusters;
}
function referenceIds(value) {
    if (value === undefined || value === null) return [];
    var refs = field(value, 'ManagedObjectReference');
    return list(refs === undefined ? value : refs).map(txt).filter(function(v) { return !!v; });
}
function collectPerformanceVmInventory(clusters) {
    if (!clusters.length) return;
    var datastoreTypes = {}, vmRows = [], view = null;
    try {
        view = vim('CreateContainerView', mo('ViewManager', svc.view) + '<container type="Folder">' + escapeXml(svc.root) + '</container><type>VirtualMachine</type><type>Datastore</type><recursive>true</recursive>');
        var id = txt(view); if (!id) fail('VM inventory view reference unavailable'); extraViews.push(id);
        var body = mo('PropertyCollector', svc.collector) + '<specSet>' +
            '<propSet><type>VirtualMachine</type><all>false</all><pathSet>name</pathSet><pathSet>config.instanceUuid</pathSet><pathSet>datastore</pathSet></propSet>' +
            '<propSet><type>Datastore</type><all>false</all><pathSet>summary.type</pathSet></propSet>' +
            '<objectSet><obj type="ContainerView">' + escapeXml(id) + '</obj><skip>true</skip><selectSet xsi:type="TraversalSpec"><name>view</name><type>ContainerView</type><path>view</path><skip>false</skip></selectSet></objectSet></specSet><options><maxObjects>500</maxObjects></options>';
        var page = vim('RetrievePropertiesEx', body), pages = 0;
        while (page) {
            if (++pages > 500) fail('VM inventory exceeded page limit');
            list(field(page, 'objects')).forEach(function(obj) {
                var ref = field(obj, 'obj'), type = ref && ref['@type'], props = {};
                list(field(obj, 'propSet')).forEach(function(p) { var key = txt(field(p, 'name')); if (key) props[key] = field(p, 'val'); });
                if (type === 'Datastore') {
                    var dsId = txt(ref), dsType = txt(field(props, 'summary.type'));
                    if (dsId && dsType) datastoreTypes[dsId] = dsType.toLowerCase();
                } else if (type === 'VirtualMachine') {
                    var instanceUuid=txt(props['config.instanceUuid']) || txt(field(props['config.instanceUuid'], 'instanceUuid'));
                    vmRows.push({name:txt(props.name), uuid:instanceUuid, datastores:referenceIds(props.datastore)});
                    if (vmRows.length > 10000) fail('VM inventory exceeded 10000 virtual machines');
                }
            });
            var token = txt(field(page, 'token')); if (!token) break;
            page = vim('ContinueRetrievePropertiesEx', mo('PropertyCollector', svc.collector) + '<token>' + escapeXml(token) + '</token>');
            if (!page) fail('Empty VM inventory continuation response');
        }
        clusters.forEach(function(c) { (c.datastore_ids || []).forEach(function(dsId) {
            if (datastoreTypes[dsId] === 'vsan') vmRows.forEach(function(vm) {
                if (vm.datastores.indexOf(dsId) < 0) return;
                if (!vm.uuid || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(vm.uuid)) {
                    c.perf_vm_warning = 'Some vSAN VMs have no valid instance UUID; per-VM metrics skipped'; return;
                }
                if (!c.perf_vms.some(function(existing) { return existing.uuid === vm.uuid; })) c.perf_vms.push({id:vm.uuid, uuid:vm.uuid, name:vm.name || vm.uuid});
            });
        }); });
    } catch (e) {
        clusters.forEach(function(c) { c.perf_vms = []; c.perf_vm_warning = 'VM inventory or datastore mapping unavailable: ' + String(e.message || 'read-only inventory query failed'); });
    }
}
function collectTopology(clusters, withDatastores) {
    var view = vim('CreateContainerView', mo('ViewManager', svc.view) + '<container type="Folder">' + escapeXml(svc.root) + '</container><type>HostSystem</type>' + (withDatastores ? '<type>Datastore</type>' : '') + '<recursive>true</recursive>');
    var id = txt(view); if (!id) fail('Topology view reference unavailable'); extraViews.push(id);
    var body = mo('PropertyCollector', svc.collector) + '<specSet><propSet><type>HostSystem</type><all>false</all><pathSet>name</pathSet><pathSet>parent</pathSet><pathSet>runtime.connectionState</pathSet><pathSet>config.vsanHostConfig.enabled</pathSet><pathSet>config.vsanHostConfig.faultDomainInfo</pathSet><pathSet>config.vsanHostConfig.clusterInfo</pathSet></propSet>' +
        (withDatastores ? '<propSet><type>Datastore</type><all>false</all><pathSet>summary</pathSet></propSet>' : '') + '<objectSet><obj type="ContainerView">' + escapeXml(id) + '</obj><skip>true</skip><selectSet xsi:type="TraversalSpec"><name>view</name><type>ContainerView</type><path>view</path><skip>false</skip></selectSet></objectSet></specSet><options><maxObjects>100</maxObjects></options>';
    var page = vim('RetrievePropertiesEx', body), pages = 0, hosts = [], datastores = {}, clusterMap = {};
    clusters.forEach(function(c) { clusterMap[c.id] = c; });
    while (page) {
        if (++pages > 100) fail('Topology exceeded page limit');
        list(field(page, 'objects')).forEach(function (obj) {
            var ref = field(obj, 'obj'), oid = txt(ref), type = ref && ref['@type'], props = {};
            if (!oid || !/^[A-Za-z0-9_.:-]+$/.test(oid)) fail('Topology object ID unavailable or invalid');
            list(field(obj, 'propSet')).forEach(function(p) { var k = txt(field(p, 'name')); if (k) props[k] = field(p, 'val'); });
            if (type === 'HostSystem') {
                var name = txt(props.name), parent = txt(props.parent);
                if (!name || !parent) fail('Host name or parent unavailable in topology');
                var host = {id:oid, name:name, parent:parent, connection:txt(props['runtime.connectionState']) || 'unknown'};
                if (clusterMap[parent]) { host.cluster_id = parent; host.cluster_name = clusterMap[parent].name; }
                var enabled = txt(props['config.vsanHostConfig.enabled']); if (enabled !== null) host.vsan_enabled = enabled;
                var domain = txt(field(props['config.vsanHostConfig.faultDomainInfo'], 'name')); if (domain !== null) host.fault_domain = domain;
                var node = txt(field(props['config.vsanHostConfig.clusterInfo'], 'nodeUuid')); if (node) host.node_uuid = node;
                hosts.push(host); if (hosts.length > 5000) fail('Topology exceeded 5000 hosts');
            } else if (type === 'Datastore') {
                var s = props.summary; if (!s) return;
                var accessible = txt(field(s, 'accessible')), dtype = txt(field(s, 'type'));
                datastores[oid] = {id:oid, name:txt(field(s, 'name')), type:dtype, accessible:accessible};
            }
        });
        var token = txt(field(page, 'token')); if (!token) break;
        page = vim('ContinueRetrievePropertiesEx', mo('PropertyCollector', svc.collector) + '<token>' + escapeXml(token) + '</token>');
        if (!page) fail('Empty topology continuation response');
    }
    var associated = [];
    clusters.forEach(function(c) {
        if (!hosts.some(function(h) { return h.cluster_id === c.id; })) fail('No hosts visible for a vSAN cluster; topology discovery is incomplete');
    });
    if (withDatastores) clusters.forEach(function(c) { c.datastore_ids.forEach(function(did) {
        var d = datastores[did];
        if (!d || !d.type || !d.name) fail('Referenced datastore is unavailable or inaccessible to account');
        if (d.type.toLowerCase() === 'vsan') associated.push({id:d.id, name:d.name, cluster_id:c.id, cluster_name:c.name, accessible:d.accessible || 'unknown'});
    }); });
    return {hosts:hosts, datastores:associated};
}
function collectPools(cluster, topology) {
    var result = {pools:[], warning:'', incomplete:false}, errors = [];
    if (cluster.architecture === 'OSA') { result.warning = 'Storage pools are not applicable to OSA'; return result; }
    if (cluster.architecture !== 'ESA') { result.warning = 'Cluster architecture unavailable'; result.incomplete = true; return result; }
    var members = topology.hosts.filter(function(h) { return h.cluster_id === cluster.id; });
    if (!members.length) { result.warning = 'No cluster hosts are visible in vCenter'; result.incomplete = true; return result; }
    members.forEach(function(host) {
        if (host.connection !== 'connected') { errors.push(host.id + ': host not connected'); return; }
        try {
            var body = mo('VimClusterVsanVcDiskManagementSystem', 'vsan-disk-management-system') + '<host type="HostSystem">' + escapeXml(host.id) + '</host><filterSpec><vsanDiskType>storagePool</vsanDiskType></filterSpec>';
            var response = vsan('QueryVsanManagedDisks', body), raw = field(response, 'storagePools');
            if (!response || raw === undefined || raw === null) { errors.push(host.id + ': storage pool information not returned'); return; }
            var pools = list(raw); if (pools.length !== 1) { errors.push(host.id + ': pool count cannot be uniquely identified'); return; }
            var item = {host_id:host.id, host_name:host.name, warning:''}, disks = field(pools[0], 'storagePoolDisks');
            if (disks === undefined || disks === null) item.warning = 'Storage pool disk list not returned';
            else item.disk_count = list(disks).length;
            result.pools.push(item);
        } catch (e) { errors.push(host.id + ': ' + String(e.message || 'storage pool query failed')); }
    });
    if (errors.length) { result.warning = errors.join('; '); result.incomplete = true; }
    return result;
}
function collectHealth(cluster) {
    var fields = ['timestamp', 'overallHealth', 'overallHealthDescription', 'groups', 'networkHealth'];
    var body = mo('VsanVcClusterHealthSystem', 'vsan-cluster-health-system') + '<cluster type="ClusterComputeResource">' + escapeXml(cluster.id) + '</cluster><includeObjUuids>false</includeObjUuids>';
    fields.forEach(function (f) { body += '<fields>' + f + '</fields>'; });
    body += '<fetchFromCache>true</fetchFromCache>';
    var data = vsan('VsanQueryVcClusterHealthSummary', body);
    if (!data || typeof data !== 'object') fail('Health response is empty');
    var stamp = txt(field(data, 'timestamp')), parsed = stamp === null ? NaN : Date.parse(stamp);
    var maxAge = Number(input.max_age), age = isNaN(parsed) ? null : Math.floor(Date.now() / 1000 - parsed / 1000);
    var cacheError = age === null ? 'Health cache timestamp unavailable' :
        (age < -300 ? 'Health cache timestamp is in the future' : (age > maxAge ? 'Health cache is stale' : ''));
    var h = {status: cacheError ? 'stale' : (txt(field(data, 'overallHealth')) || 'unavailable'), description: txt(field(data, 'overallHealthDescription')),
        timestamp: stamp, cache_error: cacheError, groups: [], tests: []};
    if (age !== null && age >= 0) h.cache_age = age;
    var network = field(data, 'networkHealth');
    h.network_warning = cacheError || (!network ? 'Cached network health unavailable' : '');
    if (!h.network_warning) {
        var issue = txt(field(network, 'issueFound')), parts = field(network, 'partitions');
        if (issue === 'true' || issue === 'false') h.network_issue = issue === 'true' ? 1 : 0;
        else h.network_warning = 'Network issue flag unavailable';
        if (parts !== undefined && parts !== null) h.network_partitions = list(parts).length;
    }
    list(field(data, 'groups')).forEach(function (g) {
        var id = txt(field(g, 'groupId')), n = txt(field(g, 'groupName'));
        if (!id) return;
        var progress = txt(field(g, 'inProgress')) === 'true';
        h.groups.push({id: id, name: n || id, status: progress ? 'in_progress' : (cacheError ? 'stale' : (txt(field(g, 'groupHealth')) || 'unavailable')), inProgress: progress});
        if (progress) return;
        list(field(g, 'groupTests')).forEach(function (t) {
            var tid = txt(field(t, 'testId'));
            if (tid) h.tests.push({groupId: id, id: tid, name: txt(field(t, 'testName')) || tid,
                status: cacheError ? 'stale' : (txt(field(t, 'testHealth')) || 'unavailable'), description: txt(field(t, 'testShortDescription'))});
        });
    });
    return h;
}
function collectCapacity(cluster) {
    var body = mo('VsanSpaceReportSystem', 'vsan-cluster-space-report-system') + '<cluster type="ClusterComputeResource">' + escapeXml(cluster.id) + '</cluster><whatifCapacityOnly>false</whatifCapacityOnly>';
    var data = vsan('VsanQuerySpaceUsage', body);
    if (!data || typeof data !== 'object') fail('Capacity response is empty');
    var total = txt(field(data, 'totalCapacityB')), free = txt(field(data, 'freeCapacityB')), c = {warning: ''};
    if (total !== null && /^\d+$/.test(total)) c.total = total;
    if (free !== null && /^\d+$/.test(free)) c.free = free;
    else c.warning = 'Free capacity was not returned or is invalid';
    if (c.total !== undefined && c.free !== undefined && compareDecimal(c.free, c.total) > 0) fail('Capacity free exceeds total');
    if (c.total !== undefined && Number(c.total) === 0) c.warning = 'Total capacity is zero; percentage unavailable';
    if (c.total !== undefined && c.free !== undefined && Number(c.total) > 0) {
        c.used = subtractDecimal(c.total, c.free);
        c.used_percent = 100 * Number(c.used) / Number(c.total);
        c.free_percent = 100 * Number(c.free) / Number(c.total);
    }
    if (c.total === undefined) fail('Capacity total not returned');
    var overview = field(data, 'spaceOverview'), missing = [];
    var overviewFields = {overheadB:'overhead', temporaryOverheadB:'temporary_overhead', primaryCapacityB:'primary', provisionCapacityB:'provisioned', reservedCapacityB:'reserved', overReservedB:'over_reserved', physicalUsedB:'physical_used', usedB:'object_used', snapshotUsedB:'snapshot_used'};
    Object.keys(overviewFields).forEach(function (apiName) {
        var value = txt(field(overview, apiName));
        if (value !== null && /^\d+$/.test(value)) c[overviewFields[apiName]] = value;
        else missing.push(apiName);
    });
    c.overview_warning = missing.length ? 'Space overview fields unavailable: ' + missing.join(', ') : '';
    var details = field(field(data, 'spaceDetail'), 'spaceUsageByObjectType'), seen = {};
    c.categories = []; c.detail_warning = '';
    if (details === undefined || details === null) c.detail_warning = 'Capacity breakdown by object type unavailable or empty';
    else list(details).forEach(function (entry) {
        var type = txt(field(entry, 'objType')), ext = txt(field(entry, 'objTypeExt')) || '';
        if (!type || !/^[A-Za-z0-9_.:-]+$/.test(type) || (ext && !/^[A-Za-z0-9_.:-]+$/.test(ext))) {
            c.detail_warning = 'Capacity breakdown has an invalid or unavailable category identifier'; return;
        }
        var id = type + '|' + ext;
        if (Object.prototype.hasOwnProperty.call(seen, id)) { c.detail_warning = 'Capacity breakdown has duplicate category identifiers'; return; }
        seen[id] = true;
        var category = {id:id, type:type, extension:ext, description:txt(field(entry, 'objTypeExtDesc')) || ''};
        Object.keys(overviewFields).forEach(function (apiName) {
            var value = txt(field(entry, apiName));
            if (value !== null && /^\d+$/.test(value)) category[overviewFields[apiName]] = value;
        });
        c.categories.push(category);
    });
    return c;
}
function collectObjectHealth(cluster) {
    var body = mo('VsanVcClusterHealthSystem', 'vsan-cluster-health-system') + '<cluster type="ClusterComputeResource">' + escapeXml(cluster.id) + '</cluster><includeObjUuids>false</includeObjUuids><fields>timestamp</fields><fields>objectHealth</fields><fetchFromCache>true</fetchFromCache>';
    var data = vsan('VsanQueryVcClusterHealthSummary', body);
    if (!data || typeof data !== 'object') fail('Object health response is empty');
    var stamp = txt(field(data, 'timestamp')), parsed = stamp === null ? NaN : Date.parse(stamp);
    var age = isNaN(parsed) ? null : Math.floor(Date.now() / 1000 - parsed / 1000);
    if (age === null) fail('Object health cache timestamp unavailable');
    if (age < -300) fail('Object health cache timestamp is in the future');
    if (age > Number(input.max_age)) fail('Object health cache is stale');
    var overall = field(data, 'objectHealth'), detail = field(overall, 'objectHealthDetail');
    if (!overall || detail === null || detail === undefined) fail('Object health details unavailable or empty');
    var result = {states: []}, seen = {};
    list(detail).forEach(function (entry) {
        var state = txt(field(entry, 'health')), count = txt(field(entry, 'numObjects'));
        var source = txt(field(entry, 'vsanClusterUuid')) || 'local';
        if (!state || !/^[A-Za-z0-9_]+$/.test(state) || !/^[A-Za-z0-9_.:-]+$/.test(source) || !count || !/^\d+$/.test(count)) fail('Incomplete object health details');
        var key = source + ':' + state;
        if (Object.prototype.hasOwnProperty.call(seen, key)) fail('Duplicate object health state and source');
        seen[key] = true;
        result.states.push({state: state, source: source, count: count});
    });
    return result;
}
function collectResync(cluster) {
    var body = mo('VsanObjectSystem', 'vsan-cluster-object-system') + '<cluster type="ClusterComputeResource">' + escapeXml(cluster.id) + '</cluster><syncingObjectFilter><numberOfObjects>100</numberOfObjects><offset>0</offset></syncingObjectFilter>';
    var data = vsan('QuerySyncingVsanObjectsSummary', body);
    if (!data || typeof data !== 'object') fail('Resync summary response is empty');
    var out = {}, missing = [];
    function read(from, apiName, key) {
        var val = txt(field(from, apiName));
        if (val !== null && /^\d+$/.test(val)) out[key] = val;
        else missing.push(apiName);
    }
    read(data, 'totalObjectsToSync', 'objects');
    read(data, 'totalBytesToSync', 'bytes');
    read(data, 'totalRecoveryETA', 'eta');
    var detail = field(data, 'syncingObjectRecoveryDetails');
    var names = [['activeObjectsToSync','active_objects'], ['queuedObjectsToSync','queued_objects'],
        ['suspendedObjectsToSync','suspended_objects'], ['bytesToSyncForActiveObjects','active_bytes'],
        ['bytesToSyncForQueuedObjects','queued_bytes'], ['bytesToSyncForSuspendedObjects','suspended_bytes'],
        ['activelySyncingObjectRecoveryETA','active_eta'], ['queuedForSyncObjectRecoveryETA','queued_eta'],
        ['suspendedObjectRecoveryETA','suspended_eta']];
    names.forEach(function (n) { read(detail, n[0], n[1]); });
    out.warning = missing.length ? 'Fields unavailable: ' + missing.join(', ') : '';
    var objects = list(field(data, 'objects')), reasons = {}, components = 0, noReasons = 0;
    objects.forEach(function(o) { list(field(o, 'components')).forEach(function(component) {
        components++;
        var rr = list(field(component, 'reasons'));
        if (!rr.length) noReasons++;
        rr.forEach(function(r) { var reason = txt(r); if (reason && /^[A-Za-z0-9_.-]+$/.test(reason)) reasons[reason] = (reasons[reason] || 0) + 1; });
    }); });
    out.sampled_objects = objects.length; out.sampled_components = components;
    out.reasons = Object.keys(reasons).sort().map(function(r) { return r + ': ' + reasons[r]; }).join(', ');
    out.reason_warning = '';
    if (out.objects === undefined) out.reason_warning = 'Total resync objects unavailable; reason sample completeness unknown';
    else if (Number(out.objects) > 0) out.reason_warning = 'Reasons cover at most 100 sampled objects; ' + objects.length + ' returned, ' + components + ' components, ' + noReasons + ' without a reason';
    return out;
}
function collectDisks(cluster) {
    var body = mo('VsanVcClusterHealthSystem', 'vsan-cluster-health-system') + '<cluster type="ClusterComputeResource">' + escapeXml(cluster.id) + '</cluster><includeObjUuids>false</includeObjUuids><fields>timestamp</fields><fields>physicalDisksHealth</fields><fetchFromCache>true</fetchFromCache>';
    var data = vsan('VsanQueryVcClusterHealthSummary', body);
    if (!data || typeof data !== 'object') fail('Disk health response is empty');
    var stamp = txt(field(data, 'timestamp')), parsed = stamp === null ? NaN : Date.parse(stamp);
    var age = isNaN(parsed) ? null : Math.floor(Date.now() / 1000 - parsed / 1000);
    if (age === null) fail('Disk health cache timestamp unavailable');
    if (age < -300) fail('Disk health cache timestamp is in the future');
    var cacheLimit = mode === 'diskmeta' ? Number(input.diskmeta_max_age) : Number(input.max_age);
    if (age > cacheLimit) fail(mode === 'diskmeta' ? 'Disk metadata cache is older than the configured limit' : 'Disk health cache is stale');
    var hosts = field(data, 'physicalDisksHealth');
    if (hosts === undefined || hosts === null) fail('Cached physical disk health unavailable or empty');
    var result = {disks: []}, seen = {};
    list(hosts).forEach(function (host) {
        if (field(host, 'error') !== undefined && field(host, 'error') !== null) fail('Physical disk health collection failed on a host');
        var hostname = txt(field(host, 'hostname')) || 'unknown';
        list(field(host, 'disks')).forEach(function (disk) {
            var id = txt(field(disk, 'uuid')), name = txt(field(disk, 'name'));
            if (!id || !/^[A-Za-z0-9_.:-]+$/.test(id) || !name) fail('Physical disk identity unavailable or invalid');
            if (Object.prototype.hasOwnProperty.call(seen, id)) fail('Duplicate physical disk UUID');
            seen[id] = true;
            var item = {id:id, name:name, host:hostname};
            var fields = [['summaryHealth','health'],['operationalHealth','operational_health'],
                ['operationalHealthDescription','operational_description'], ['metadataHealth','metadata_health'],
                ['capacityHealth','capacity_health'], ['capacity','capacity'], ['usedCapacity','used_capacity'],
                ['reservedCapacity','reserved_capacity'], ['congestionValue','congestion'], ['vsanDiskGroupUuid','disk_group_uuid']];
            fields.forEach(function (f) { var v=txt(field(disk, f[0])); if (v !== null && v !== '') item[f[1]]=v; });
            if (!item.health) item.health = 'unavailable';
            if (item.disk_group_uuid && !/^[A-Za-z0-9_.:-]+$/.test(item.disk_group_uuid)) fail('Invalid disk group UUID');
            var scsi = field(disk, 'scsiDisk');
            [['vendor','vendor'],['model','model'],['revision','firmware'],['serialNumber','serial'],['ssd','ssd']].forEach(function (f) {
                var v=txt(field(scsi, f[0])); if (v !== null && v !== '') item[f[1]]=v;
            });
            result.disks.push(item);
        });
    });
    return result;
}
function collectWitness(cluster) {
    var body = mo('VimClusterVsanVcStretchedClusterSystem', 'vsan-stretched-cluster-system') + '<cluster type="ClusterComputeResource">' + escapeXml(cluster.id) + '</cluster>';
    var raw = vsan('VSANVcGetWitnessHosts', body), witnesses = [], seen = {};
    list(raw).forEach(function(w) {
        if (txt(field(w, 'metadataMode')) === 'true') return;
        var id = txt(field(w, 'nodeUuid')), host = txt(field(w, 'host'));
        if (!id && !host) return;
        if (!id || !/^[A-Za-z0-9_.:-]+$/.test(id)) fail('Witness UUID unavailable or invalid');
        if (host && !/^[A-Za-z0-9_.:-]+$/.test(host)) fail('Witness host reference invalid');
        if (Object.prototype.hasOwnProperty.call(seen, id)) fail('Duplicate witness UUID');
        seen[id] = true;
        var entry = {id:id, host_id:host || 'unavailable'};
        [['faultDomainName','fault_domain'],['preferredFdName','preferred_domain'],['preferredFdUuid','preferred_domain_uuid'],['unicastAgentAddr','unicast_address']].forEach(function(f) {
            var v = txt(field(w, f[0])); if (v !== null && v !== '') entry[f[1]] = v;
        });
        if (entry.preferred_domain_uuid && !/^[A-Za-z0-9_.:-]+$/.test(entry.preferred_domain_uuid)) fail('Preferred fault domain UUID invalid');
        witnesses.push(entry);
    });
    return {witnesses:witnesses, count:witnesses.length};
}
function collectSmart(cluster) {
    var body = mo('VsanVcClusterHealthSystem', 'vsan-cluster-health-system') + '<cluster type="ClusterComputeResource">' + escapeXml(cluster.id) + '</cluster>';
    var raw = vsan('VsanQueryVcClusterSmartStatsSummary', body);
    if (raw === undefined || raw === null) fail('S.M.A.R.T. data unavailable or empty');
    var result = {disks:[]}, seen = {};
    list(raw).forEach(function(h) {
        var host = txt(field(h, 'hostname')); if (!host) fail('S.M.A.R.T. host name unavailable');
        list(field(h, 'smartStats')).forEach(function(d) {
            var name = txt(field(d, 'disk')); if (!name) fail('S.M.A.R.T. disk name unavailable');
            var pair = JSON.stringify([host,name]); if (Object.prototype.hasOwnProperty.call(seen,pair)) fail('Duplicate S.M.A.R.T. host and disk name');
            seen[pair] = true;
            var item = {host:host, name:name, warning:''}, params = field(d, 'stats');
            if (field(d, 'error') !== undefined && field(d, 'error') !== null) item.warning = 'S.M.A.R.T. query failed for disk';
            else if (!params) item.warning = 'S.M.A.R.T. parameters unavailable';
            else list(params).forEach(function(p) {
                var id = txt(field(p, 'parameter')), value = txt(field(p, 'value'));
                var names = {smarthealthstatus:'health', smartmediawearoutindicator:'wear_raw', smartdrivetemperature:'temperature_raw', smartreaderrorcount:'read_errors_raw', smartwriteerrorcount:'write_errors_raw'};
                if (!Object.prototype.hasOwnProperty.call(names,id) || value === null || !/^\d+$/.test(value)) return;
                if (id === 'smarthealthstatus' && Number(value) > 3) return;
                item[names[id]] = value;
            });
            if (!item.warning) {
                var absent = ['health','wear_raw','temperature_raw','read_errors_raw','write_errors_raw'].filter(function(k) { return !Object.prototype.hasOwnProperty.call(item,k); });
                if (absent.length) item.warning = 'S.M.A.R.T. values unavailable: ' + absent.join(', ');
            }
            result.disks.push(item);
        });
    });
    result.warning = result.disks.length ? '' : 'S.M.A.R.T. device list unavailable or empty';
    return result;
}
function perfTimestamp(value) {
    value = String(value).replace(/^\s+|\s+$/g, '');
    // vSAN 8.0 U3 emits UTC timestamps as "YYYY-MM-DD HH:mm:ss".
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) value = value.replace(' ', 'T') + 'Z';
    return Date.parse(value);
}
function collectPerformance(cluster) {
    var cref = '<cluster type="ClusterComputeResource">' + escapeXml(cluster.id) + '</cluster>';
    var cfg = vsan('VsanClusterGetConfig', mo('VsanVcClusterConfigSystem', 'vsan-cluster-config-system') + cref);
    var enabled = txt(field(field(cfg, 'perfsvcConfig'), 'enabled'));
    var out = {service: enabled === 'true' ? 'enabled' : (enabled === 'false' ? 'disabled' : 'unknown'), warning: ''};
    if (enabled === 'false') { out.warning = 'Performance Service is disabled'; out.detail_warning = 'Performance Service is disabled'; out.vms = []; return out; }
    if (!cluster.uuid) fail('vSAN cluster UUID unavailable');
    var want = {iopsRead:'iops_read', iopsWrite:'iops_write', throughputRead:'throughput_read',
        throughputWrite:'throughput_write', latencyAvgRead:'latency_read', latencyAvgWrite:'latency_write',
        congestion:'congestion', oio:'outstanding_io'};
    // vSAN 8.0 U3 exposes no cluster argument for this operation.
    var metadata = vsan('VsanPerfGetSupportedEntityTypes', mo('VsanPerformanceManager', 'vsan-performance-manager'));
    var found = {}, conflicts = {};
    function readGraph(graph) {
        var unit = txt(field(graph, 'unit'));
        list(field(graph, 'metrics')).forEach(function (m) {
            var label = txt(field(m, 'label')), group = txt(field(m, 'group')) || '';
            if (!Object.prototype.hasOwnProperty.call(want, label) || !unit) return;
            if (found[label] && (found[label].unit !== unit || found[label].group !== group)) conflicts[label] = true;
            else found[label] = {unit:unit, group:group};
        });
        var second = field(graph, 'secondGraph'); if (second) readGraph(second);
    }
    list(metadata).forEach(function (entity) {
        if (txt(field(entity, 'name')) !== 'cluster-domclient') return;
        ['graphs','advancedGraphs','verboseGraphs'].forEach(function (key) { list(field(entity, key)).forEach(readGraph); });
    });
    var byGroup = {}, validLabels = {}, missing = [], validCount = 0;
    Object.keys(want).forEach(function (label) {
        var m = found[label], valid = m && !conflicts[label] &&
            ((label.indexOf('latency') === 0 && ['time_ms','time_us','time_ns','time_s'].indexOf(m.unit) !== -1) ||
             (label.indexOf('throughput') === 0 && m.unit === 'rate_bytes') ||
             ((label.indexOf('iops') === 0 || label === 'congestion' || label === 'oio') && m.unit === 'number'));
        if (!valid) { missing.push(label + ': unsupported or ambiguous unit'); return; }
        validLabels[label] = true;
        if (!byGroup[m.group]) byGroup[m.group] = [];
        byGroup[m.group].push(label); validCount++;
    });
    if (!validCount) { out.warning = 'No supported cluster performance counters or unit metadata'; return out; }
    var now = Date.now(), maxAge = Number(input.perf_max_age);
    var start = new Date(now - maxAge * 1000).toISOString(), end = new Date(now).toISOString();
    var request = mo('VsanPerformanceManager', 'vsan-performance-manager');
    Object.keys(byGroup).forEach(function (group) {
        request += '<querySpecs><entityRefId>cluster-domclient:' + escapeXml(cluster.uuid) + '</entityRefId><startTime>' + start + '</startTime><endTime>' + end + '</endTime>';
        if (group) request += '<group>' + escapeXml(group) + '</group>';
        byGroup[group].forEach(function (label) { request += '<labels>' + escapeXml(label) + '</labels>'; });
        request += '</querySpecs>';
    });
    request += cref;
    var series = list(vsan('VsanPerfQueryPerf', request)), samples = {};
    series.forEach(function (entity) {
        if (txt(field(entity, 'entityRefId')) !== 'cluster-domclient:' + cluster.uuid) return;
        var timestamps = txt(field(entity, 'sampleInfo'));
        if (!timestamps) return;
        timestamps = timestamps.split(',');
        list(field(entity, 'value')).forEach(function (entry) {
            var metricId = field(entry, 'metricId'), label = txt(field(metricId, 'label'));
            var responseGroup = txt(field(metricId, 'group')), valueList = txt(field(entry, 'values'));
            if (!label || !validLabels[label] || (responseGroup && responseGroup !== found[label].group) || !valueList) return;
            var vals = valueList.split(','); if (vals.length !== timestamps.length) return;
            for (var i = vals.length - 1; i >= 0; i--) {
                var str = vals[i].replace(/^\s+|\s+$/g, ''), timestamp = perfTimestamp(timestamps[i]);
                if (!/^\d+(?:\.\d+)?$/.test(str) || isNaN(timestamp) || timestamp > now + 300000 || now - timestamp > maxAge * 1000) continue;
                // On vCenter 8.0 U3 the graph's time_ms is a display unit; these latency counters are observed as raw microseconds.
                var raw = Number(str), unit = found[label].unit, factor = unit === 'time_ms' || unit === 'time_us' ? 0.000001 : (unit === 'time_ns' ? 0.000000001 : 1);
                if (isFinite(raw) && (!samples[label] || timestamp > samples[label].at)) samples[label] = {value:raw * factor, at:timestamp};
            }
        });
    });
    Object.keys(want).forEach(function (label) {
        if (samples[label]) out[want[label]] = samples[label].value;
        else if (validLabels[label]) missing.push(label + ': no current sample');
    });
    [['iopsRead','iopsWrite','iops_total'],['throughputRead','throughputWrite','throughput_total']].forEach(function (pair) {
        if (samples[pair[0]] && samples[pair[1]] && samples[pair[0]].at === samples[pair[1]].at) out[pair[2]] = samples[pair[0]].value + samples[pair[1]].value;
    });
    if (Object.keys(samples).length) {
        var oldest = now; Object.keys(samples).forEach(function (label) { oldest = Math.min(oldest, samples[label].at); });
        out.sample_age = Math.max(0, Math.floor((now - oldest) / 1000));
    }
    out.warning = missing.join('; ');
    collectAdditionalPerformance(cluster, metadata, cref, start, end, now, maxAge, out);
    return out;
}
function collectAdditionalPerformance(cluster, metadata, cref, start, end, now, maxAge, out) {
    var warnings = [], result = {hosts:[], disks:[], vms:[]};
    var clientLabels = {iopsRead:'iops_read', iopsWrite:'iops_write', throughputRead:'throughput_read', throughputWrite:'throughput_write', latencyAvgRead:'latency_read', latencyAvgWrite:'latency_write', congestion:'congestion', oio:'outstanding_io'};
    var diskLabels = {iopsDevRead:'iops_read', iopsDevWrite:'iops_write', throughputDevRead:'throughput_read', throughputDevWrite:'throughput_write', latencyDevRead:'latency_read', latencyDevWrite:'latency_write'};
    var vmLabels = {iopsRead:'iops_read', iopsWrite:'iops_write', throughputRead:'throughput_read', throughputWrite:'throughput_write', latencyRead:'latency_read', latencyWrite:'latency_write'};
    if (cluster.perf_vm_warning) warnings.push(cluster.perf_vm_warning);
    function execute(type, targets, desired, destination) {
        if (!targets.length) return;
        if (targets.length > 300) { warnings.push(type + ': more than 300 entities; collection skipped'); return; }
        var supported = {}, conflicts = {};
        function graph(g) {
            var unit=txt(field(g,'unit'));
            list(field(g,'metrics')).forEach(function(m) {
                var label=txt(field(m,'label')), group=txt(field(m,'group')) || '';
                if (!Object.prototype.hasOwnProperty.call(desired,label) || !unit) return;
                if (supported[label] && (supported[label].unit!==unit || supported[label].group!==group)) conflicts[label]=true;
                else supported[label]={unit:unit,group:group};
            });
            var second=field(g,'secondGraph'); if(second) graph(second);
        }
        list(metadata).forEach(function(e) { if(txt(field(e,'name'))===type) ['graphs','advancedGraphs','verboseGraphs'].forEach(function(k) { list(field(e,k)).forEach(graph); }); });
        var groups={}, validLabels={};
        Object.keys(desired).forEach(function(label) {
            var m=supported[label], f=desired[label], valid=m && !conflicts[label] &&
                ((f.indexOf('latency')===0 && ['time_ms','time_us','time_ns','time_s'].indexOf(m.unit)!==-1) ||
                 (f.indexOf('throughput')===0 && m.unit==='rate_bytes') ||
                 ((f.indexOf('iops')===0 || f==='congestion' || f==='outstanding_io') && m.unit==='number'));
            if (!valid) { warnings.push(type + '/' + label + ': unsupported metadata'); return; }
            validLabels[label]=true; if(!groups[m.group]) groups[m.group]=[]; groups[m.group].push(label);
        });
        var specs=[], byRef={}, seen={};
        targets.forEach(function(t) {
            var ref=type+':'+t.uuid;
            if(seen[ref]) { warnings.push(type + ': duplicate entity UUID'); return; }
            seen[ref]=true; var record={id:t.id}; if(t.name) record.name=t.name; var item={record:record,samples:{}}; byRef[ref]=item;
            if(destination) destination.push(record);
            Object.keys(groups).forEach(function(group) {
                var spec='<querySpecs><entityRefId>'+escapeXml(ref)+'</entityRefId><startTime>'+start+'</startTime><endTime>'+end+'</endTime>';
                if(group) spec+='<group>'+escapeXml(group)+'</group>';
                groups[group].forEach(function(label) { spec+='<labels>'+escapeXml(label)+'</labels>'; });
                specs.push(spec+'</querySpecs>');
            });
        });
        for(var offset=0;offset<specs.length;offset+=50) {
            var response;
            try { response=vsan('VsanPerfQueryPerf',mo('VsanPerformanceManager','vsan-performance-manager')+specs.slice(offset,offset+50).join('')+cref); }
            catch(e) { warnings.push(type + ': performance query failed'); continue; }
            list(response).forEach(function(series) {
                var ref=txt(field(series,'entityRefId')), target=byRef[ref], times=txt(field(series,'sampleInfo'));
                if(!target || !times) return; times=times.split(',');
                list(field(series,'value')).forEach(function(metric) {
                    var mid=field(metric,'metricId'), label=txt(field(mid,'label')), group=txt(field(mid,'group')), values=txt(field(metric,'values'));
                    if(!Object.prototype.hasOwnProperty.call(desired,label) || !validLabels[label] || (group && group!==supported[label].group) || !values) return;
                    var valuesArray=values.split(','); if(valuesArray.length!==times.length) return;
                    for(var i=valuesArray.length-1;i>=0;i--) {
                        var str=valuesArray[i].replace(/^\s+|\s+$/g,''), at=perfTimestamp(times[i]);
                        if(!/^\d+(?:\.\d+)?$/.test(str) || isNaN(at) || at>now+300000 || now-at>maxAge*1000) continue;
                        var n=Number(str), unit=supported[label].unit, factor=(unit==='time_ms'||unit==='time_us')?0.000001:(unit==='time_ns'?0.000000001:1);
                        if(isFinite(n) && (!target.samples[label] || at>target.samples[label].at)) target.samples[label]={value:n*factor,at:at};
                    }
                });
            });
        }
        Object.keys(byRef).forEach(function(ref) {
            var target=byRef[ref], valid=target.samples;
            Object.keys(valid).forEach(function(label) { target.record[desired[label]]=valid[label].value; });
            [['iopsRead','iopsWrite','iops_total'],['throughputRead','throughputWrite','throughput_total'],['iopsDevRead','iopsDevWrite','iops_total'],['throughputDevRead','throughputDevWrite','throughput_total']].forEach(function(pair) {
                if(valid[pair[0]] && valid[pair[1]] && valid[pair[0]].at===valid[pair[1]].at) target.record[pair[2]]=valid[pair[0]].value+valid[pair[1]].value;
            });
            var unavailable=Object.keys(desired).filter(function(label) { return !valid[label]; });
            if(!Object.keys(valid).length) target.record.warning='No current supported performance samples; check API capability and cached sample availability';
            else target.record.warning=unavailable.length ? 'Counters unavailable: '+unavailable.join(', ') : '';
            if(!destination && target.record.throughput_resync_read!==undefined) out.resync_read_bps=target.record.throughput_resync_read;
        });
    }
    execute('cluster-domcompmgr',[{id:cluster.id,uuid:cluster.uuid}],{tputResyncRead:'throughput_resync_read'},null);
    execute('host-domclient',cluster.perf_hosts || [],clientLabels,result.hosts);
    execute('virtual-machine',cluster.perf_vms || [],vmLabels,result.vms);
    if(cluster.architecture==='OSA') {
        ['cache-disk','capacity-disk'].forEach(function(type) { execute(type,(cluster.perf_disks || []).filter(function(d){return d.type===type;}).map(function(d){return {id:d.id,uuid:d.id};}),diskLabels,result.disks); });
    } else if(cluster.architecture==='ESA') warnings.push('Per-physical-disk performance entity is not documented for ESA');
    if(!(cluster.perf_hosts || []).length) warnings.push('Host vSAN UUIDs unavailable');
    if(cluster.architecture==='OSA' && !(cluster.perf_disks || []).length) warnings.push('OSA cache/capacity disk UUID mappings unavailable');
    out.hosts=result.hosts; out.disks=result.disks; out.vms=result.vms; out.detail_warning=warnings.join('; ');
}
function compareDecimal(a, b) {
    a = a.replace(/^0+(?=\d)/, ''); b = b.replace(/^0+(?=\d)/, '');
    if (a.length !== b.length) return a.length > b.length ? 1 : -1;
    return a === b ? 0 : (a > b ? 1 : -1);
}
/* Exact decimal subtraction avoids rounding uint64 capacities above 2^53. */
function subtractDecimal(a, b) {
    var result = '', borrow = 0, j = b.length - 1;
    for (var i = a.length - 1; i >= 0; i--, j--) {
        var digit = Number(a.charAt(i)) - (j >= 0 ? Number(b.charAt(j)) : 0) - borrow;
        borrow = digit < 0 ? 1 : 0;
        if (borrow) digit += 10;
        result = String(digit) + result;
    }
    return result.replace(/^0+(?=\d)/, '');
}
try {
    if (['inventory', 'health', 'capacity', 'objects', 'resync', 'disks', 'diskmeta', 'performance', 'topology', 'witness', 'pools', 'smart'].indexOf(mode) < 0) fail('Invalid collection mode');
    if (input.enabled !== '0' && input.enabled !== '1') fail('Monitoring category enabled flag must be 0 or 1');
    if (input.enabled === '0' && mode !== 'inventory' && mode !== 'topology') {
        output.disabled = true; output.state = 'disabled by macro'; return JSON.stringify(output);
    }
    if (!input || typeof input.url !== 'string' || !/^https:\/\/([^\/@?#\s]+|\[[0-9a-fA-F:]+\])(?::[0-9]+)?\/?$/.test(input.url)) fail('URL must be an HTTPS origin without path or credentials');
    if (!input.username || !input.password) fail('Username or password is empty');
    if (['health', 'objects', 'disks'].indexOf(mode) !== -1 && (!/^[0-9]+$/.test(String(input.max_age)) || Number(input.max_age) < 300)) fail('Invalid health cache max age');
    if (mode === 'diskmeta' && (!/^[0-9]+$/.test(String(input.diskmeta_max_age)) || Number(input.diskmeta_max_age) < 300 || Number(input.diskmeta_max_age) > 604800)) fail('Invalid disk metadata cache max age');
    if (mode === 'performance' && (!/^[0-9]+$/.test(String(input.perf_max_age)) || Number(input.perf_max_age) < 300 || Number(input.perf_max_age) > 86400)) fail('Invalid performance maximum sample age');
    input.url = input.url.replace(/\/$/, '');
    req = new HttpRequest({SSLVerifyPeer: true, SSLVerifyHost: true});
    if (input.proxy) req.setProxy(input.proxy);
    output.clusters = inventory();
    if (mode === 'topology') {
        output.topology = collectTopology(output.clusters, true);
        if (JSON.stringify(output.topology).length > 8 * 1024 * 1024) fail('Topology exceeded the output limit');
    }
    else if (mode !== 'inventory') {
        var poolTopology = mode === 'pools' ? collectTopology(output.clusters, false) : null;
        output.version = serviceVersion();
        var outputSize = 0;
        output.clusters.forEach(function (c) {
            try {
                output.data[c.id] = {error: '', value: mode === 'health' ? collectHealth(c) : (mode === 'capacity' ? collectCapacity(c) : (mode === 'objects' ? collectObjectHealth(c) : (mode === 'resync' ? collectResync(c) : ((mode === 'disks' || mode === 'diskmeta') ? collectDisks(c) : (mode === 'witness' ? collectWitness(c) : (mode === 'pools' ? collectPools(c, poolTopology) : (mode === 'smart' ? collectSmart(c) : collectPerformance(c))))))))};
                if (mode === 'pools' && output.data[c.id].value.incomplete) output.partial++;
            }
            catch (e) { output.partial++; output.data[c.id] = {error: String(e.message || 'Subsystem request failed')}; }
            outputSize += JSON.stringify(output.data[c.id]).length + c.id.length;
            if (outputSize > 8 * 1024 * 1024) fail('Collected data exceeded the output limit');
        });
    }
} catch (e) {
    output.error = String(e.message || 'Collection failed');
    if (!authenticated) output.availability_error = output.error;
    output.clusters = [];
    output.data = {};
} finally {
    if (svc) extraViews.forEach(function (id) { try { vim('DestroyView', mo('ContainerView', id)); } catch (ignore) {} });
    if (viewId && svc) { try { vim('DestroyView', mo('ContainerView', viewId)); } catch (ignore) {} }
    if (authenticated && svc) { try { vim('Logout', mo('SessionManager', svc.session)); } catch (ignore) {} }
}
return JSON.stringify(output);
