require 'yaml'
require 'set'
require 'digest'
root=File.expand_path('../..', __dir__)
path=File.join(root,'template_vmware_vsan_http.yaml')
hash_before=Digest::SHA256.file(path).hexdigest
system('ruby',File.join(root,'build.rb'),out: File::NULL) or abort 'Build failed'
abort 'Build is not deterministic' unless hash_before==Digest::SHA256.file(path).hexdigest
doc=YAML.load_file(path)
abort 'Wrong export version' unless doc.fetch('zabbix_export').fetch('version')=='8.0'
t=doc['zabbix_export']['templates'].fetch(0)
items=t.fetch('items'); rules=t.fetch('discovery_rules'); prototypes=rules.flat_map{|r|r.fetch('item_prototypes',[])}
all=items+rules+prototypes
keys=all.map{|i|i.fetch('key')}
abort 'Duplicate item/discovery key' unless keys.uniq.length==keys.length
abort 'Invalid item namespace' unless keys.all?{|k|k.start_with?('vsan.')}
masters=items.map{|i|i['key']}.to_set
(all.select{|i|i['type']=='DEPENDENT'}).each{|i| abort("Invalid master #{i['key']}") unless masters.include?(i.fetch('master_item').fetch('key'))}
uuids=[]
walk=lambda{|v| case v; when Hash; v.each{|k,x| uuids << x if k=='uuid';walk.call(x)}; when Array; v.each{|x|walk.call(x)};end}
walk.call(doc); abort 'Duplicate or invalid UUIDv4' unless uuids.uniq.length==uuids.length && uuids.all?{|x| x.match?(/\A[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}\z/)}
rules.each do |rule|
  proto_keys=rule.fetch('item_prototypes',[]).map{|i|i['key']}.to_set
  rule.fetch('graph_prototypes',[]).each{|g|g.fetch('graph_items').each{|i|abort 'Invalid graph reference' unless proto_keys.include?(i.fetch('item').fetch('key'))}}
end
proto_keys=prototypes.map{|i|i['key']}.to_set
t.fetch('dashboards',[]).each do |dashboard|
  dashboard.fetch('pages',[]).each do |page|
    page.fetch('widgets',[]).each do |widget|
      widget.fetch('fields',[]).each do |field|
        next unless %w[ITEM ITEM_PROTOTYPE].include?(field['type'])
        ref=field.fetch('value'); set=field['type']=='ITEM' ? masters : proto_keys
        abort 'Invalid dashboard item reference' unless ref['host']==t['template'] && set.include?(ref['key'])
      end
    end
  end
end
script=File.read(File.join(root,'src/collector.js'))
items.select{|i|i['type']=='SCRIPT'}.each{|i|abort 'Embedded JavaScript mismatch' unless i.fetch('params')==script}
triggers=(items+prototypes).flat_map{|i|i.fetch('triggers',[])+i.fetch('trigger_prototypes',[])}
triggers.each do |trigger|
  abort 'Wrong trigger host' unless trigger.fetch('expression').include?("/#{t['template']}/vsan.")
  trigger.fetch('dependencies',[]).each do |dependency|
    target=triggers.find{|x|x['name']==dependency['name'] && x['expression']==dependency['expression']}
    abort "Unresolved trigger dependency #{dependency['name']}" unless target
    abort 'Recovery dependency mismatch' if dependency.key?('recovery_expression') && target['recovery_expression']!=dependency['recovery_expression']
  end
end
secret=t.fetch('macros').find{|m|m['macro']=='{$VSAN.PASSWORD}'}
abort 'Password macro is not secret' unless secret && secret['type']=='SECRET_TEXT'
trigger_count=triggers.length
graph_count=rules.sum{|r|r.fetch('graph_prototypes',[]).length}
puts "YAML parsed; UUIDs and keys unique; master and graph references resolve; stable build; #{items.length} items, #{rules.length} LLD, #{prototypes.length} prototypes, #{trigger_count} triggers, #{graph_count} graphs, #{t.fetch('dashboards',[]).length} dashboard."
puts 'Static structural checks are not a Zabbix configuration.import test.'
