# Установка и настройка

1. Создайте/используйте отдельную учётную запись с минимальными правами чтения для нужных объектов vCenter. См. [права](permissions.md).
2. Импортируйте `template_vmware_vsan_http.yaml`, создайте отдельный logical host для vCenter и привяжите `VMware vSAN by HTTP`.
3. На хосте задайте `{$VSAN.URL}` прямым HTTPS origin, например `https://vc.example.com:443`, без пути и credentials; заполните `{$VSAN.USERNAME}` и `{$VSAN.PASSWORD}`. Пароль имеет тип Secret text. `{$VSAN.HTTP.PROXY}` опционален.
4. На узле Zabbix Server/Proxy системное хранилище доверия должно уже проверять сертификат и имя vCenter. Частный CA, не доверенный системой по умолчанию, требует настройки trust store ОС — это внешнее исключение из Zero-Touch; шаблон не меняет файлы Zabbix и TLS-сертификаты VMware.
5. Проверьте Latest data и элементы диагностики: ошибки API/категорий, возраст cached health, предупреждения capacity/performance, disk metadata и SMART. Сравните discovery с объектами, видимыми учётной записи.

Целевой процесс на стороне VMware: только предоставление учётной записи с правами чтения. Конфигурация ESXi/vCenter/vSAN не меняется. При выключенной категории или недоступном API шаблон продолжает сбор остальных категорий и показывает диагностическую причину.

## Стандартные интервалы и freshness

| Категория | По умолчанию |
|---|---:|
| Inventory, ESA pools | 1h |
| Cached Skyline Health | 10m |
| Capacity, включая категории объектов | 30m |
| Object health | 15m |
| Resync summary/reasons | 5m |
| Disk health, used/reserved capacity, SMART | 30m |
| Статические характеристики дисков | 1d |
| Performance, включая VM/host/disk | 10m |
| Topology | 10m |
| Witness | 30m |

Интервалы меняются макросами `{$VSAN.INTERVAL.<CATEGORY>}`. `{$VSAN.TIMEOUT}` по умолчанию 60s на Script item. Максимальный возраст health cache `{$VSAN.HEALTH.MAX.AGE}` = 3600 секунд, performance samples `{$VSAN.PERF.MAX.AGE}` = 900 секунд, metadata cache для дисков `{$VSAN.DISKMETA.MAX.AGE}` = 172800 секунд (48h). `{$VSAN.API.NODATA}` = 45m, для медленных категорий = 2h, для ежедневных disk metadata = `{$VSAN.API.NODATA.METADATA}` = 26h. При изменении интервалов проверьте пороги nodata/freshness.

Категории health, capacity, objects, resync, disks, diskmeta, performance, witness, pools и smart управляются `{$VSAN.<CATEGORY>.ENABLED}` (1 — собирать, 0 — отключить). Inventory и topology необходимы для discovery и связей; при отключённой категории discovery не выдаёт пустой результат.

Фильтры по именам используют macros `MATCHES/NOT_MATCHES` для cluster, host, datastore, VM, disk, capacity category, Skyline group и test. Они фильтруют обнаруживаемые объекты, а не запросы к vCenter. После ошибки/частичного ответа discovery сохраняет ранее найденные объекты; успешное исчезновение применяется с периодами disable 7d/delete 30d.

Начальные пороги capacity 75/85/95%, восстановление с гистерезисом 3 процентных пункта. Latency хранится в секундах: 0.015/0.030 — 15/30 ms, усреднение 5m; триггеры latency выключены, пока не проверен масштаб на вашей версии. Resync: пороги 4h/24h и минимумы 200/1200 выборок; при изменении частоты пересчитайте выборки. Сырые SMART wear значения зависят от производителя; пороговые триггеры выключены. Это стартовые значения проекта, не рекомендации Broadcom.

## Явные исключения Zero-Touch

- Если TLS-сертификат vCenter не доверен системе узла Server/Proxy, настройка доверия в ОС должна быть выполнена администратором; шаблон не может обойти проверку TLS безопасным способом.
- Производительность по VM, хостам и дискам доступна только если Performance Service уже включён и соответствующие entity/counters опубликованы API. Шаблон сервис не включает; остальные категории продолжают работать.
- Права чтения должны давать видимость нужных кластеров, хостов, datastore и VM. Ограниченная visibility уменьшает discovery без изменения конфигурации VMware.
