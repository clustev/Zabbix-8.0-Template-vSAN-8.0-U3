# Элементы данных и происхождение

Перечислены все элементы и прототипы текущего YAML. Во всех строках цель — vCenter/vSAN 8.0 U3; применимость необязательных полей зависит от API и конфигурации. Предыдущая редакция проверялась на одном живом кластере OSA; текущие интервалы и ежедневная disk metadata редакция live-import не проходили. Исключения: diskgroup только OSA, pool только ESA; witness и preferred FD применимы только там, где их возвращает API. Таблица показывает стандартные интервалы master items; их можно изменить макросами. В Zabbix 8.0.0 и vCenter 8.0.3 проверены импорт, повторный импорт, inventory, кэшированный health, capacity, resync без активных объектов и host/disk/VM performance на OSA; непустые причины resync и ESA пока проверены только синтетически.

Сокращения источников и официальные ссылки (время и имена нормализованных полей соответствуют `src/collector.js`):

- **I** — `/sdk`, `RetrievePropertiesEx`/`ContinueRetrievePropertiesEx`, inventory: `configurationEx` с извлечением `vsanConfigInfo`, `name`; [vSphere API](https://developer.broadcom.com/xapis/vsphere-web-services-api/latest/vmodl.query.PropertyCollector.html). API version также читается GET `/sdk/vsanServiceVersions.xml`.
- **T** — `/sdk`, PropertyCollector: HostSystem `name`, `parent`, `runtime.connectionState`, `config.vsanHostConfig.*`; Datastore `summary.*`; [HostSystem 8.0 U3](https://dp-downloads.broadcom.com/api-content/apis/API_VMA_001/8.0U3/html/vim.HostSystem.html). Число hosts — подсчёт видимых записей.
- **H/O/D/D2** — `/vsanHealth`, `VsanQueryVcClusterHealthSummary` с `fetchFromCache=true`; H обновляется раз в 10m, O раз в 15m и D раз в 30m. Источник содержит `overallHealth`, `overallHealthDescription`, `timestamp`, `networkHealth`, `groups[].groupTests[]`; `objectHealth.objectHealthDetail[]`; `physicalDisksHealth[].disks[]` и `scsiDisk`. **D2** использует тот же cached summary, но опрашивается отдельно раз в день для статических vendor/model/firmware/serial/SSD/physical capacity; принудительная проверка не вызывается. [Health 8.0 U3](https://dp-downloads.broadcom.com/api-content/apis/API_VMA_001/8.0U3/html/vim.cluster.VsanVcClusterHealthSystem.html).
- **C** — `/vsanHealth`, `VsanQuerySpaceUsage`: `totalCapacityB`, `freeCapacityB`, `spaceOverview.*`, `spaceDetail.spaceUsageByObjectType[]`; [SpaceUsage 8.0 U3](https://dp-downloads.broadcom.com/api-content/apis/API_VMA_001/8.0U3/html/vim.cluster.VsanSpaceUsage.html), [поля overview](https://developer.broadcom.com/xapis/vsan-management-api/latest/vim.cluster.VsanObjectSpaceSummary.html). Used = total − free; проценты вычисляются от total.
- **R** — `/vsanHealth`, `QuerySyncingVsanObjectsSummary`: `totalObjectsToSync`, `totalBytesToSync`, `totalRecoveryETA`, `syncingObjectRecoveryDetails.*`, `objects[].components[].reasons` (ограниченная выборка до 100 объектов); [Object System](https://developer.broadcom.com/xapis/vsan-management-api/latest/vim.cluster.VsanObjectSystem.html).
- **S** — `/vsanHealth`, `VsanQueryVcClusterSmartStatsSummary`: `hostname`, `smartStats[].disk`, `stats[].parameter/value`; [Health 8.0 U3](https://dp-downloads.broadcom.com/api-content/apis/API_VMA_001/8.0U3/html/vim.cluster.VsanVcClusterHealthSystem.html).
- **P** — `/vsanHealth`, `VsanClusterGetConfig`, `VsanPerfGetSupportedEntityTypes`, `VsanPerfQueryPerf`: `perfsvcConfig.enabled`, описания graphs/metrics и выборки `sampleInfo`, `value[].metricId/values`, типы `cluster-domclient`, `cluster-domcompmgr`, `host-domclient`, `cache-disk`, `capacity-disk`, `virtual-machine`; [Performance Manager](https://developer.broadcom.com/xapis/vsan-management-api/latest/vim.cluster.VsanPerformanceManager.html).
- **W** — `/vsanHealth`, `VSANVcGetWitnessHosts`: `nodeUuid`, `host`, `faultDomainName`, `preferredFdName/Uuid`, `unicastAgentAddr`; [Stretched Cluster](https://developer.broadcom.com/xapis/vsan-management-api/latest/vim.cluster.VsanVcStretchedClusterSystem.html). Элемент connection дополнительно использует T.
- **L** — `/vsanHealth`, `QueryVsanManagedDisks` по host с `vsanDiskType=storagePool`: `storagePools[].storagePoolDisks`; [Disk Management 8.0 U3](https://dp-downloads.broadcom.com/api-content/apis/API_VMA_001/8.0U3/html/vim.cluster.VsanVcDiskManagementSystem.html).

Ниже `Поле результата` — путь в нормализованном JSON или диагностическое вычисление; исходные поля API и преобразования подробно указаны перед таблицей и после неё. Ошибки означают результат соответствующего запроса/проверки, а не отдельную метрику VMware. `—` в единицах обозначает текст, перечисление или безразмерное значение, `count` — количество.

| Item key | Назначение (имя в шаблоне) | Единица | Интервал | Источник | Поле результата / вычисление |
|---|---|---|---|---|---|
| `vsan.inventory.get` | vSAN: Get inventory | — | 1h | I | `нормализованный JSON` |
| `vsan.inventory.error` | vSAN: Inventory API error | — | 1h | I | `$.error` |
| `vsan.health.get` | vSAN: Get health | — | 10m | H | `нормализованный JSON` |
| `vsan.health.error` | vSAN: Health API error | — | 10m | H | `$.error` |
| `vsan.health.state` | vSAN: Health monitoring state | — | 10m | H | `$.state` |
| `vsan.capacity.get` | vSAN: Get capacity | — | 30m | C | `нормализованный JSON` |
| `vsan.capacity.error` | vSAN: Capacity API error | — | 30m | C | `$.error` |
| `vsan.capacity.state` | vSAN: Capacity monitoring state | — | 30m | C | `$.state` |
| `vsan.objects.get` | vSAN: Get objects | — | 15m | O | `нормализованный JSON` |
| `vsan.objects.error` | vSAN: Objects API error | — | 15m | O | `$.error` |
| `vsan.objects.state` | vSAN: Objects monitoring state | — | 15m | O | `$.state` |
| `vsan.resync.get` | vSAN: Get resync | — | 5m | R | `нормализованный JSON` |
| `vsan.resync.error` | vSAN: Resync API error | — | 5m | R | `$.error` |
| `vsan.resync.state` | vSAN: Resync monitoring state | — | 5m | R | `$.state` |
| `vsan.disks.get` | vSAN: Get disks | — | 30m | D | `нормализованный JSON` |
| `vsan.disks.error` | vSAN: Disks API error | — | 30m | D | `$.error` |
| `vsan.disks.state` | vSAN: Disks monitoring state | — | 30m | D | `$.state` |
| `vsan.diskmeta.get` | vSAN: Get daily disk metadata from cached health | — | 1d | D2 | `нормализованный JSON` |
| `vsan.diskmeta.error` | vSAN: Disk metadata API error | — | 1d | D2 | `$.error` |
| `vsan.diskmeta.state` | vSAN: Disk metadata monitoring state | — | 1d | D2 | `$.state` |
| `vsan.diskmeta.partial` | vSAN: Disk metadata clusters with collection errors | count | 1d | D2 | `число кластеров с ошибкой/неполными данными` |
| `vsan.performance.get` | vSAN: Get performance | — | 10m | P | `нормализованный JSON` |
| `vsan.performance.error` | vSAN: Performance API error | — | 10m | P | `$.error` |
| `vsan.performance.state` | vSAN: Performance monitoring state | — | 10m | P | `$.state` |
| `vsan.topology.get` | vSAN: Get topology | — | 10m | T | `нормализованный JSON` |
| `vsan.topology.error` | vSAN: Topology API error | — | 10m | T | `$.error` |
| `vsan.witness.get` | vSAN: Get witness | — | 30m | W | `нормализованный JSON` |
| `vsan.witness.error` | vSAN: Witness API error | — | 30m | W | `$.error` |
| `vsan.witness.state` | vSAN: Witness monitoring state | — | 30m | W | `$.state` |
| `vsan.pools.get` | vSAN: Get pools | — | 1h | L | `нормализованный JSON` |
| `vsan.pools.error` | vSAN: Pools API error | — | 1h | L | `$.error` |
| `vsan.pools.state` | vSAN: Pools monitoring state | — | 1h | L | `$.state` |
| `vsan.smart.get` | vSAN: Get smart | — | 30m | S | `нормализованный JSON` |
| `vsan.smart.error` | vSAN: Smart API error | — | 30m | S | `$.error` |
| `vsan.smart.state` | vSAN: Smart monitoring state | — | 30m | S | `$.state` |
| `vsan.api.availability.error` | vSAN: vCenter authentication error | — | 10m | T | `$.availability_error` |
| `vsan.cluster.count` | vSAN: Discovered clusters | count/код | 1h | I | `clusters.length` |
| `vsan.health.partial` | vSAN: Health clusters with collection errors | count/код | 10m | H | `число кластеров с ошибкой/неполными данными` |
| `vsan.capacity.partial` | vSAN: Capacity clusters with collection errors | count/код | 30m | C | `число кластеров с ошибкой/неполными данными` |
| `vsan.objects.partial` | vSAN: Object health clusters with collection errors | count/код | 15m | O | `число кластеров с ошибкой/неполными данными` |
| `vsan.resync.partial` | vSAN: Resync clusters with collection errors | count/код | 5m | R | `число кластеров с ошибкой/неполными данными` |
| `vsan.disks.partial` | vSAN: Disk health clusters with collection errors | count/код | 30m | D | `число кластеров с ошибкой/неполными данными` |
| `vsan.performance.partial` | vSAN: Performance clusters with collection errors | count/код | 10m | P | `число кластеров с ошибкой/неполными данными` |
| `vsan.witness.partial` | vSAN: Witness clusters with collection errors | count/код | 30m | W | `число кластеров с ошибкой/неполными данными` |
| `vsan.pools.partial` | vSAN: Pool clusters with incomplete collection | count/код | 1h | L | `число кластеров с ошибкой/неполными данными` |
| `vsan.smart.partial` | vSAN: S.M.A.R.T. clusters with collection errors | count/код | 30m | S | `число кластеров с ошибкой/неполными данными` |
| `vsan.api.version` | vSAN: Discovered API version | — | 10m | H | `$.version` |
| `vsan.cluster.capacity.total[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Total capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.total` |
| `vsan.cluster.capacity.free[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Free capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.free` |
| `vsan.cluster.capacity.used[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Used capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.used` |
| `vsan.cluster.capacity.used_percent[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Used capacity percentage | % | 30m | C | `$.data["{#VSAN.ID}"].value.used_percent` |
| `vsan.cluster.capacity.free_percent[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Free capacity percentage | % | 30m | C | `$.data["{#VSAN.ID}"].value.free_percent` |
| `vsan.cluster.health.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Health collection error | — | 10m | H | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.capacity.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Capacity collection error | — | 30m | C | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.objects.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Objects collection error | — | 15m | O | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.resync.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync collection error | — | 5m | R | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.disks.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Disks collection error | — | 30m | D | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.diskmeta.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Diskmeta collection error | — | 1d | D2 | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.performance.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Performance collection error | — | 10m | P | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.witness.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Witness collection error | — | 30m | W | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.pools.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Pools collection error | — | 1h | L | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.smart.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Smart collection error | — | 30m | S | `$.data["{#VSAN.ID}"].error` |
| `vsan.cluster.health[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Overall health | — | 10m | H | `$.data["{#VSAN.ID}"].value.status` |
| `vsan.cluster.health.description[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Health description | — | 10m | H | `$.data["{#VSAN.ID}"].value.description` |
| `vsan.cluster.health.timestamp[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Health cache timestamp | — | 10m | H | `$.data["{#VSAN.ID}"].value.timestamp` |
| `vsan.cluster.health.cache.age[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Health cache age | s | 10m | H | `$.data["{#VSAN.ID}"].value.cache_age` |
| `vsan.cluster.capacity.warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Capacity metric warning | — | 30m | C | `$.data["{#VSAN.ID}"].value.warning` |
| `vsan.cluster.capacity.overhead[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Object redundancy overhead | B | 30m | C | `$.data["{#VSAN.ID}"].value.overhead` |
| `vsan.cluster.capacity.temporary_overhead[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Object temporary overhead | B | 30m | C | `$.data["{#VSAN.ID}"].value.temporary_overhead` |
| `vsan.cluster.capacity.primary[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Object primary data | B | 30m | C | `$.data["{#VSAN.ID}"].value.primary` |
| `vsan.cluster.capacity.provisioned[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Object provisioned capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.provisioned` |
| `vsan.cluster.capacity.reserved[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Object policy reserved capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.reserved` |
| `vsan.cluster.capacity.over_reserved[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Object over-reserved capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.over_reserved` |
| `vsan.cluster.capacity.physical_used[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Object physical used capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.physical_used` |
| `vsan.cluster.capacity.object_used[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Object used capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.object_used` |
| `vsan.cluster.capacity.snapshot_used[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: vSAN snapshots physical usage | B | 30m | C | `$.data["{#VSAN.ID}"].value.snapshot_used` |
| `vsan.cluster.capacity.overview.warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Capacity overview warning | — | 30m | C | `$.data["{#VSAN.ID}"].value.overview_warning` |
| `vsan.cluster.capacity.category.warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Capacity category warning | — | 30m | C | `$.data["{#VSAN.ID}"].value.detail_warning` |
| `vsan.cluster.health.cache.error[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Health cache error | — | 10m | H | `$.data["{#VSAN.ID}"].value.cache_error` |
| `vsan.cluster.network.issue[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Cached network issue | count/код | 10m | H | `$.data["{#VSAN.ID}"].value.network_issue` |
| `vsan.cluster.network.partitions[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Network partitions | count/код | 10m | H | `$.data["{#VSAN.ID}"].value.network_partitions` |
| `vsan.cluster.network.warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Network health warning | — | 10m | H | `$.data["{#VSAN.ID}"].value.network_warning` |
| `vsan.cluster.architecture[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Architecture | — | 1h | I | `$.clusters[?(@.id == "{#VSAN.ID}")].architecture.first()` |
| `vsan.cluster.witness.count[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Configured witnesses | count/код | 30m | W | `$.data["{#VSAN.ID}"].value.count` |
| `vsan.cluster.pools.warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Storage pool collection warning | — | 1h | L | `$.data["{#VSAN.ID}"].value.warning` |
| `vsan.cluster.smart.warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: S.M.A.R.T. collection warning | — | 30m | S | `$.data["{#VSAN.ID}"].value.warning` |
| `vsan.cluster.hosts.total[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Hosts in inventory | count/код | 10m | T | `подсчёт hosts кластера` |
| `vsan.cluster.hosts.connected[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Hosts connected to vCenter | count/код | 10m | T | `число hosts со state connected` |
| `vsan.cluster.hosts.unavailable[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Hosts disconnected or not responding | count/код | 10m | T | `число hosts со state disconnected/notResponding` |
| `vsan.cluster.resync.objects[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync objects | count/код | 5m | R | `$.data["{#VSAN.ID}"].value.objects` |
| `vsan.cluster.resync.bytes[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync remaining bytes | B | 5m | R | `$.data["{#VSAN.ID}"].value.bytes` |
| `vsan.cluster.resync.eta[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync estimated remaining time | s | 5m | R | `$.data["{#VSAN.ID}"].value.eta` |
| `vsan.cluster.resync.active_objects[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync active objects | count/код | 5m | R | `$.data["{#VSAN.ID}"].value.active_objects` |
| `vsan.cluster.resync.queued_objects[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync queued objects | count/код | 5m | R | `$.data["{#VSAN.ID}"].value.queued_objects` |
| `vsan.cluster.resync.suspended_objects[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync suspended objects | count/код | 5m | R | `$.data["{#VSAN.ID}"].value.suspended_objects` |
| `vsan.cluster.resync.active_bytes[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync active bytes | B | 5m | R | `$.data["{#VSAN.ID}"].value.active_bytes` |
| `vsan.cluster.resync.queued_bytes[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync queued bytes | B | 5m | R | `$.data["{#VSAN.ID}"].value.queued_bytes` |
| `vsan.cluster.resync.suspended_bytes[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync suspended bytes | B | 5m | R | `$.data["{#VSAN.ID}"].value.suspended_bytes` |
| `vsan.cluster.resync.active_eta[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync active estimated time | s | 5m | R | `$.data["{#VSAN.ID}"].value.active_eta` |
| `vsan.cluster.resync.queued_eta[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync queued estimated time | s | 5m | R | `$.data["{#VSAN.ID}"].value.queued_eta` |
| `vsan.cluster.resync.suspended_eta[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync suspended estimated time | s | 5m | R | `$.data["{#VSAN.ID}"].value.suspended_eta` |
| `vsan.cluster.resync.warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync metric warning | — | 5m | R | `$.data["{#VSAN.ID}"].value.warning` |
| `vsan.cluster.resync.sampled_objects[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Sampled resync objects | count/код | 5m | R | `$.data["{#VSAN.ID}"].value.sampled_objects` |
| `vsan.cluster.resync.sampled_components[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Sampled resync components | count/код | 5m | R | `$.data["{#VSAN.ID}"].value.sampled_components` |
| `vsan.cluster.resync.reasons[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Sampled resync reasons | — | 5m | R | `$.data["{#VSAN.ID}"].value.reasons` |
| `vsan.cluster.resync.reason_warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync reason sampling warning | — | 5m | R | `$.data["{#VSAN.ID}"].value.reason_warning` |
| `vsan.cluster.resync.read_bps[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Resync read throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.resync_read_bps` |
| `vsan.cluster.performance.iops_read[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Read IOPS | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.iops_read` |
| `vsan.cluster.performance.iops_write[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Write IOPS | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.iops_write` |
| `vsan.cluster.performance.iops_total[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Total IOPS | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.iops_total` |
| `vsan.cluster.performance.throughput_read[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Read throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.throughput_read` |
| `vsan.cluster.performance.throughput_write[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Write throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.throughput_write` |
| `vsan.cluster.performance.throughput_total[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Total throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.throughput_total` |
| `vsan.cluster.performance.latency_read[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Read latency | s | 10m | P | `$.data["{#VSAN.ID}"].value.latency_read` |
| `vsan.cluster.performance.latency_write[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Write latency | s | 10m | P | `$.data["{#VSAN.ID}"].value.latency_write` |
| `vsan.cluster.performance.congestion[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Congestion | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.congestion` |
| `vsan.cluster.performance.outstanding_io[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Outstanding I/O | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.outstanding_io` |
| `vsan.cluster.performance.sample_age[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Oldest performance sample age | s | 10m | P | `$.data["{#VSAN.ID}"].value.sample_age` |
| `vsan.cluster.performance.service[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Performance Service state | — | 10m | P | `$.data["{#VSAN.ID}"].value.service` |
| `vsan.cluster.performance.warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Performance metric warning | — | 10m | P | `$.data["{#VSAN.ID}"].value.warning` |
| `vsan.cluster.performance.detail.warning[{#VSAN.ID}]` | vSAN [{#VSAN.NAME}]: Detailed performance warning | — | 10m | P | `$.data["{#VSAN.ID}"].value.detail_warning` |
| `vsan.capacity.category.overhead[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] Redundancy overhead | B | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].overhead.first()` |
| `vsan.capacity.category.temporary_overhead[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] Temporary overhead | B | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].temporary_overhead.first()` |
| `vsan.capacity.category.primary[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] Primary data | B | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].primary.first()` |
| `vsan.capacity.category.provisioned[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] Provisioned capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].provisioned.first()` |
| `vsan.capacity.category.reserved[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] Object policy reserved capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].reserved.first()` |
| `vsan.capacity.category.over_reserved[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] Over-reserved capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].over_reserved.first()` |
| `vsan.capacity.category.physical_used[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] Physical used capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].physical_used.first()` |
| `vsan.capacity.category.object_used[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] Used capacity | B | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].object_used.first()` |
| `vsan.capacity.category.snapshot_used[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] Snapshot usage | B | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].snapshot_used.first()` |
| `vsan.capacity.category.description[{#VSAN.ID},"{#VSAN.CATEGORY.ID}"]` | vSAN [{#VSAN.NAME}]: Category [{#VSAN.CATEGORY.ID}] description | — | 30m | C | `$.data["{#VSAN.ID}"].value.categories[?(@.id == "{#VSAN.CATEGORY.ID}")].description.first()` |
| `vsan.health.group.status[{#VSAN.ID},"{#VSAN.GROUP.ID}"]` | vSAN [{#VSAN.NAME}]: Group {#VSAN.GROUP.NAME} status | — | 10m | H | `$.data["{#VSAN.ID}"].value.groups[?(@.id == "{#VSAN.GROUP.ID}")].status.first()` |
| `vsan.health.test.status[{#VSAN.ID},"{#VSAN.GROUP.ID}","{#VSAN.TEST.ID}"]` | vSAN [{#VSAN.NAME}]: Test {#VSAN.TEST.NAME} status | — | 10m | H | `$.data["{#VSAN.ID}"].value.tests[?(@.groupId == "{#VSAN.GROUP.ID}" && @.id == "{#VSAN.TEST.ID}")].status.first()` |
| `vsan.health.test.description[{#VSAN.ID},"{#VSAN.GROUP.ID}","{#VSAN.TEST.ID}"]` | vSAN [{#VSAN.NAME}]: Test {#VSAN.TEST.NAME} description | — | 10m | H | `$.data["{#VSAN.ID}"].value.tests[?(@.groupId == "{#VSAN.GROUP.ID}" && @.id == "{#VSAN.TEST.ID}")].description.first()` |
| `vsan.object.state.count[{#VSAN.ID},"{#VSAN.OBJECT.SOURCE}","{#VSAN.OBJECT.STATE}"]` | vSAN [{#VSAN.NAME}]: Objects in state {#VSAN.OBJECT.STATE} ({#VSAN.OBJECT.SOURCE}) | count/код | 15m | O | `$.data["{#VSAN.ID}"].value.states[?(@.state == "{#VSAN.OBJECT.STATE}" && @.source == "{#VSAN.OBJECT.SOURCE}")].count.first()` |
| `vsan.object.inaccessible.count[{#VSAN.ID},"{#VSAN.OBJECT.SOURCE}"]` | vSAN [{#VSAN.NAME}]: Inaccessible objects ({#VSAN.OBJECT.SOURCE}) | count/код | 15m | O | `$.data["{#VSAN.ID}"].value.states[?(@.state == "inaccessible" && @.source == "{#VSAN.OBJECT.SOURCE}")].count.first()` |
| `vsan.disk.health[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk health [{#VSAN.DISK.NAME}] | — | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].health.first()` |
| `vsan.disk.operational_health[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk operational health [{#VSAN.DISK.NAME}] | — | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].operational_health.first()` |
| `vsan.disk.operational_description[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk operational health description [{#VSAN.DISK.NAME}] | — | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].operational_description.first()` |
| `vsan.disk.metadata_health[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk metadata health [{#VSAN.DISK.NAME}] | — | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].metadata_health.first()` |
| `vsan.disk.capacity_health[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk capacity health [{#VSAN.DISK.NAME}] | — | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].capacity_health.first()` |
| `vsan.disk.capacity[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk capacity [{#VSAN.DISK.NAME}] | B | 1d | D2 | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].capacity.first()` |
| `vsan.disk.used_capacity[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk used capacity [{#VSAN.DISK.NAME}] | B | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].used_capacity.first()` |
| `vsan.disk.reserved_capacity[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk reserved capacity [{#VSAN.DISK.NAME}] | B | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].reserved_capacity.first()` |
| `vsan.disk.congestion[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk congestion [{#VSAN.DISK.NAME}] | count/код | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].congestion.first()` |
| `vsan.disk.vendor[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk vendor [{#VSAN.DISK.NAME}] | — | 1d | D2 | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].vendor.first()` |
| `vsan.disk.model[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk model [{#VSAN.DISK.NAME}] | — | 1d | D2 | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].model.first()` |
| `vsan.disk.firmware[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk firmware [{#VSAN.DISK.NAME}] | — | 1d | D2 | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].firmware.first()` |
| `vsan.disk.serial[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk serial number [{#VSAN.DISK.NAME}] | — | 1d | D2 | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].serial.first()` |
| `vsan.disk.ssd[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk SSD flag [{#VSAN.DISK.NAME}] | — | 1d | D2 | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].ssd.first()` |
| `vsan.disk.disk_group_uuid[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk group UUID [{#VSAN.DISK.NAME}] | — | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].disk_group_uuid.first()` |
| `vsan.disk.smart.health[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] S.M.A.R.T. health code | count/код | 30m | S | `$.data["{#VSAN.ID}"].value.disks[?(@.host == "{#VSAN.DISK.HOST}" && @.name == "{#VSAN.DISK.NAME}")].health.first()` |
| `vsan.disk.smart.wear_raw[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] S.M.A.R.T. media wearout indicator raw | count/код | 30m | S | `$.data["{#VSAN.ID}"].value.disks[?(@.host == "{#VSAN.DISK.HOST}" && @.name == "{#VSAN.DISK.NAME}")].wear_raw.first()` |
| `vsan.disk.smart.temperature_raw[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] S.M.A.R.T. temperature raw | count/код | 30m | S | `$.data["{#VSAN.ID}"].value.disks[?(@.host == "{#VSAN.DISK.HOST}" && @.name == "{#VSAN.DISK.NAME}")].temperature_raw.first()` |
| `vsan.disk.smart.read_errors_raw[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] S.M.A.R.T. read error count raw | count/код | 30m | S | `$.data["{#VSAN.ID}"].value.disks[?(@.host == "{#VSAN.DISK.HOST}" && @.name == "{#VSAN.DISK.NAME}")].read_errors_raw.first()` |
| `vsan.disk.smart.write_errors_raw[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] S.M.A.R.T. write error count raw | count/код | 30m | S | `$.data["{#VSAN.ID}"].value.disks[?(@.host == "{#VSAN.DISK.HOST}" && @.name == "{#VSAN.DISK.NAME}")].write_errors_raw.first()` |
| `vsan.disk.smart.warning[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] S.M.A.R.T. warning | — | 30m | S | `$.data["{#VSAN.ID}"].value.disks[?(@.host == "{#VSAN.DISK.HOST}" && @.name == "{#VSAN.DISK.NAME}")].warning.first()` |
| `vsan.disk.performance.iops_read[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] Read IOPS | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].iops_read.first()` |
| `vsan.disk.performance.iops_write[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] Write IOPS | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].iops_write.first()` |
| `vsan.disk.performance.iops_total[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] Total IOPS | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].iops_total.first()` |
| `vsan.disk.performance.throughput_read[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] Read throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].throughput_read.first()` |
| `vsan.disk.performance.throughput_write[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] Write throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].throughput_write.first()` |
| `vsan.disk.performance.throughput_total[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] Total throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].throughput_total.first()` |
| `vsan.disk.performance.latency_read[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] Read latency | s | 10m | P | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].latency_read.first()` |
| `vsan.disk.performance.latency_write[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] Write latency | s | 10m | P | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].latency_write.first()` |
| `vsan.disk.performance.warning[{#VSAN.ID},"{#VSAN.DISK.ID}"]` | vSAN [{#VSAN.NAME}]: Disk [{#VSAN.DISK.NAME}] performance warning | — | 10m | P | `$.data["{#VSAN.ID}"].value.disks[?(@.id == "{#VSAN.DISK.ID}")].warning.first()` |
| `vsan.diskgroup.disks[{#VSAN.ID},"{#VSAN.DG.ID}"]` | vSAN [{#VSAN.NAME}]: Disks in disk group [{#VSAN.DG.ID}] | count/код | 30m | D | `$.data["{#VSAN.ID}"].value.disks[?(@.disk_group_uuid == "{#VSAN.DG.ID}")].length()` |
| `vsan.host.connection[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Connection to vCenter | — | 10m | T | `$.topology.hosts[?(@.id == "{#VSAN.HOST.ID}")].connection.first()` |
| `vsan.host.vsan_enabled[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] vSAN enabled | — | 10m | T | `$.topology.hosts[?(@.id == "{#VSAN.HOST.ID}")].vsan_enabled.first()` |
| `vsan.host.fault_domain[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Configured fault domain | — | 10m | T | `$.topology.hosts[?(@.id == "{#VSAN.HOST.ID}")].fault_domain.first()` |
| `vsan.host.node_uuid[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] vSAN node UUID | — | 10m | T | `$.topology.hosts[?(@.id == "{#VSAN.HOST.ID}")].node_uuid.first()` |
| `vsan.host.performance.iops_read[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Read IOPS | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].iops_read.first()` |
| `vsan.host.performance.iops_write[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Write IOPS | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].iops_write.first()` |
| `vsan.host.performance.iops_total[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Total IOPS | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].iops_total.first()` |
| `vsan.host.performance.throughput_read[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Read throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].throughput_read.first()` |
| `vsan.host.performance.throughput_write[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Write throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].throughput_write.first()` |
| `vsan.host.performance.throughput_total[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Total throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].throughput_total.first()` |
| `vsan.host.performance.latency_read[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Read latency | s | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].latency_read.first()` |
| `vsan.host.performance.latency_write[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Write latency | s | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].latency_write.first()` |
| `vsan.host.performance.congestion[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Congestion | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].congestion.first()` |
| `vsan.host.performance.outstanding_io[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] Outstanding I/O | count/код | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].outstanding_io.first()` |
| `vsan.host.performance.warning[{#VSAN.ID},"{#VSAN.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Host [{#VSAN.HOST.NAME}] performance warning | — | 10m | P | `$.data["{#VSAN.ID}"].value.hosts[?(@.id == "{#VSAN.HOST.ID}")].warning.first()` |
| `vsan.datastore.accessible[{#VSAN.ID},"{#VSAN.DATASTORE.ID}"]` | vSAN [{#VSAN.NAME}]: Datastore [{#VSAN.DATASTORE.NAME}] accessible | — | 10m | T | `$.topology.datastores[?(@.id == "{#VSAN.DATASTORE.ID}" && @.cluster_id == "{#VSAN.ID}")].accessible.first()` |
| `vsan.witness.host_id[{#VSAN.ID},"{#VSAN.WITNESS.ID}"]` | vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] Host reference | — | 30m | W | `$.data["{#VSAN.ID}"].value.witnesses[?(@.id == "{#VSAN.WITNESS.ID}")].host_id.first()` |
| `vsan.witness.fault_domain[{#VSAN.ID},"{#VSAN.WITNESS.ID}"]` | vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] Witness fault domain | — | 30m | W | `$.data["{#VSAN.ID}"].value.witnesses[?(@.id == "{#VSAN.WITNESS.ID}")].fault_domain.first()` |
| `vsan.witness.preferred_domain[{#VSAN.ID},"{#VSAN.WITNESS.ID}"]` | vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] Preferred fault domain | — | 30m | W | `$.data["{#VSAN.ID}"].value.witnesses[?(@.id == "{#VSAN.WITNESS.ID}")].preferred_domain.first()` |
| `vsan.witness.preferred_domain_uuid[{#VSAN.ID},"{#VSAN.WITNESS.ID}"]` | vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] Preferred fault domain UUID | — | 30m | W | `$.data["{#VSAN.ID}"].value.witnesses[?(@.id == "{#VSAN.WITNESS.ID}")].preferred_domain_uuid.first()` |
| `vsan.witness.unicast_address[{#VSAN.ID},"{#VSAN.WITNESS.ID}"]` | vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] Witness unicast address | — | 30m | W | `$.data["{#VSAN.ID}"].value.witnesses[?(@.id == "{#VSAN.WITNESS.ID}")].unicast_address.first()` |
| `vsan.witness.connection[{#VSAN.ID},"{#VSAN.WITNESS.ID}"]` | vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] connection to vCenter | — | 10m | T | `$.topology.hosts[?(@.id == "{#VSAN.WITNESS.HOST.ID}")].connection.first()` |
| `vsan.witness.inventory.warning[{#VSAN.ID},"{#VSAN.WITNESS.ID}"]` | vSAN [{#VSAN.NAME}]: Witness [{#VSAN.WITNESS.ID}] inventory warning | — | 10m | T | `диагностика сопоставления witness и host` |
| `vsan.faultdomain.preferred.name[{#VSAN.ID},"{#VSAN.FD.ID}"]` | vSAN [{#VSAN.NAME}]: Preferred fault domain [{#VSAN.FD.NAME}] | — | 30m | W | `$.data["{#VSAN.ID}"].value.witnesses[?(@.preferred_domain_uuid == "{#VSAN.FD.ID}")].preferred_domain.first()` |
| `vsan.pool.disks[{#VSAN.ID},"{#VSAN.POOL.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Storage pool disk count [{#VSAN.POOL.HOST.NAME}] | count/код | 1h | L | `$.data["{#VSAN.ID}"].value.pools[?(@.host_id == "{#VSAN.POOL.HOST.ID}")].disk_count.first()` |
| `vsan.pool.warning[{#VSAN.ID},"{#VSAN.POOL.HOST.ID}"]` | vSAN [{#VSAN.NAME}]: Storage pool warning [{#VSAN.POOL.HOST.NAME}] | — | 1h | L | `$.data["{#VSAN.ID}"].value.pools[?(@.host_id == "{#VSAN.POOL.HOST.ID}")].warning.first()` |
| `vsan.vm.performance.iops_read[{#VSAN.ID},"{#VSAN.VM.ID}"]` | vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] Read IOPS | IOPS | 10m | P | `$.data["{#VSAN.ID}"].value.vms[?(@.id == "{#VSAN.VM.ID}")].iops_read.first()` |
| `vsan.vm.performance.iops_write[{#VSAN.ID},"{#VSAN.VM.ID}"]` | vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] Write IOPS | IOPS | 10m | P | `$.data["{#VSAN.ID}"].value.vms[?(@.id == "{#VSAN.VM.ID}")].iops_write.first()` |
| `vsan.vm.performance.iops_total[{#VSAN.ID},"{#VSAN.VM.ID}"]` | vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] Total IOPS | IOPS | 10m | P | `$.data["{#VSAN.ID}"].value.vms[?(@.id == "{#VSAN.VM.ID}")].iops_total.first()` |
| `vsan.vm.performance.throughput_read[{#VSAN.ID},"{#VSAN.VM.ID}"]` | vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] Read throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.vms[?(@.id == "{#VSAN.VM.ID}")].throughput_read.first()` |
| `vsan.vm.performance.throughput_write[{#VSAN.ID},"{#VSAN.VM.ID}"]` | vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] Write throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.vms[?(@.id == "{#VSAN.VM.ID}")].throughput_write.first()` |
| `vsan.vm.performance.throughput_total[{#VSAN.ID},"{#VSAN.VM.ID}"]` | vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] Total throughput | Bps | 10m | P | `$.data["{#VSAN.ID}"].value.vms[?(@.id == "{#VSAN.VM.ID}")].throughput_total.first()` |
| `vsan.vm.performance.latency_read[{#VSAN.ID},"{#VSAN.VM.ID}"]` | vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] Read latency | s | 10m | P | `$.data["{#VSAN.ID}"].value.vms[?(@.id == "{#VSAN.VM.ID}")].latency_read.first()` |
| `vsan.vm.performance.latency_write[{#VSAN.ID},"{#VSAN.VM.ID}"]` | vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] Write latency | s | 10m | P | `$.data["{#VSAN.ID}"].value.vms[?(@.id == "{#VSAN.VM.ID}")].latency_write.first()` |
| `vsan.vm.performance.warning[{#VSAN.ID},"{#VSAN.VM.ID}"]` | vSAN [{#VSAN.NAME}]: VM [{#VSAN.VM.NAME}] performance warning | — | 10m | P | API/capability/permission diagnostic |

## Соответствие нормализованных полей API

`capacity`: `overhead` → `spaceOverview.overheadB`, `temporary_overhead` → `temporaryOverheadB`, `primary` → `primaryCapacityB`, `provisioned` → `provisionCapacityB`, `reserved` → `reservedCapacityB`, `over_reserved` → `overReservedB`, `physical_used` → `physicalUsedB`, `object_used` → `usedB`, `snapshot_used` → `snapshotUsedB`. Резерв объекта не является резервом перестроения хоста. Поля и группы могут отсутствовать в API; warning перечисляет их.

`resync`: objects/bytes/eta → `totalObjectsToSync`/`totalBytesToSync`/`totalRecoveryETA`; остальные поля внутри `syncingObjectRecoveryDetails`: active/queued/suspended `ObjectsToSync`, `bytesToSyncForActiveObjects`/`bytesToSyncForQueuedObjects`/`bytesToSyncForSuspendedObjects`, `activelySyncingObjectRecoveryETA`/`queuedForSyncObjectRecoveryETA`/`suspendedObjectRecoveryETA`.

`disk`: health/operational_health/operational_description/metadata_health/capacity_health → `summaryHealth`/`operationalHealth`/`operationalHealthDescription`/`metadataHealth`/`capacityHealth`; capacity/used_capacity/reserved_capacity/congestion/disk_group_uuid → `capacity`/`usedCapacity`/`reservedCapacity`/`congestionValue`/`vsanDiskGroupUuid`; vendor/model/firmware/serial/ssd → поля `scsiDisk.vendor`/`model`/`revision`/`serialNumber`/`ssd`. Число дисков OSA группы подсчитывается по UUID в кэше.

`smart`: health/wear_raw/temperature_raw/read_errors_raw/write_errors_raw → параметры `smarthealthstatus`/`smartmediawearoutindicator`/`smartdrivetemperature`/`smartreaderrorcount`/`smartwriteerrorcount`. Сырые wear/temperature не имеют подтверждённых универсальных единиц.

`performance`: iops_read/write → `iopsRead/Write`; throughput_read/write → `throughputRead/Write`; latency_read/write → `latencyAvgRead/Write`; congestion/outstanding_io → `congestion/oio`. Metadata подтверждает единицы и группу, отсутствие или конфликт пропускается. Для latency метаданные графика `time_ms` обозначают единицу отображения, но по сопоставлению ответа API и показаний vCenter 8.0 U3 сырые значения здесь трактуются как микросекунды и умножаются на 0.000001 до секунд; это сопоставление приблизительное. Сверьте график в своей версии; триггеры latency выключены по умолчанию. Throughput хранится в B/s; totals складываются только при одинаковых timestamps; sample_age — возраст старейшей из выбранных свежих точек.

`health`: `status` → `overallHealth`, `description` → `overallHealthDescription`, `timestamp` → `timestamp`, `cache_age` и `cache_error` вычисляются из timestamp; сеть → `networkHealth.issueFound` и число `partitions`; группы/тесты → groupId/groupHealth и testId/testHealth. Устаревание/отсутствие данных выражается диагностическими значениями. `objects` → `objectHealthDetail[].health/numObjects/vsanClusterUuid`; это не обязательно полный список всех объектов. `witness` отображает настройки из W; inventory warning указывает на невозможность сопоставить host с T.

VM discovery включает только VM, у которых inventory datastore list содержит vSAN datastore. Для `vsan.vm.performance.*` используются опубликованные `virtual-machine` entity/counters; при выключенном Performance Service или отсутствии counters warning объясняет отсутствие метрик. Для `vsan.host.performance.*` используются `host-domclient:<nodeUuid>` и счётчики iopsRead/Write, throughputRead/Write, latencyAvgRead/Write, congestion, oio. Для `vsan.disk.performance.*` используются `cache-disk` или `capacity-disk` с vSAN UUID из OSA diskMapping и счётчики iopsDevRead/Write, throughputDevRead/Write, latencyDevRead/Write. ESA-счётчик на каждый физический диск не реализован: документированные типы ESA имеют идентификатор хоста. `vsan.cluster.resync.read_bps` — `cluster-domcompmgr.tputResyncRead`, трафик чтения resync, не суммарная скорость копирования. `resync.reasons` и числа объектов/компонентов относятся к первым максимум 100 возвращённым объектам; число активных объектов и полнота выборки не эквивалентны.
