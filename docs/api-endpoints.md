# Используемые endpoints и методы

| Endpoint | Вызовы | Назначение |
|---|---|---|
| `/sdk` | RetrieveServiceContent, Login, Logout | Сервисные ссылки и сессия |
| `/sdk` | CreateContainerView, RetrievePropertiesEx, ContinueRetrievePropertiesEx, DestroyView | Постранично кластеры, хосты, datastore и VM с их datastore membership; временные view удаляются |
| `/sdk/vsanServiceVersions.xml` | GET | Обнаружение числовой версии API из version/priorVersions |
| `/vsanHealth` | VsanQueryVcClusterHealthSummary | Только `fetchFromCache=true`, `includeObjUuids=false`: общая health, группы/проверки, состояние объектов, сеть и физические диски |
| `/vsanHealth` | VsanQuerySpaceUsage | Физическая ёмкость и опциональный `spaceOverview` |
| `/vsanHealth` | QuerySyncingVsanObjectsSummary | Агрегированные данные resync и ограниченная выборка причин `syncingObjectFilter.numberOfObjects=100` |
| `/vsanHealth` | VsanQueryVcClusterSmartStatsSummary | Существующая статистика SMART дисков; self-test не запускается |
| `/vsanHealth` | VsanClusterGetConfig, VsanPerfGetSupportedEntityTypes, VsanPerfQueryPerf | Состояние Performance Service, поддерживаемые счётчики/единицы, опубликованные ряды кластера, хостов, OSA-дисков и VM и `tputResyncRead`; сервис не включается |
| `/vsanHealth` | VSANVcGetWitnessHosts | Конфигурация witness и связанный preferred FD |
| `/vsanHealth` | QueryVsanManagedDisks | Информация о storage pool на хостах ESA |

Ссылки: [Health и SMART, 8.0 U3](https://dp-downloads.broadcom.com/api-content/apis/API_VMA_001/8.0U3/html/vim.cluster.VsanVcClusterHealthSystem.html), [SpaceUsage 8.0 U3](https://dp-downloads.broadcom.com/api-content/apis/API_VMA_001/8.0U3/html/vim.cluster.VsanSpaceUsage.html), [Disk management 8.0 U3](https://dp-downloads.broadcom.com/api-content/apis/API_VMA_001/8.0U3/html/vim.cluster.VsanVcDiskManagementSystem.html), [Performance API](https://developer.broadcom.com/xapis/vsan-management-api/latest/vim.cluster.VsanPerformanceManager.html), [Object System](https://developer.broadcom.com/xapis/vsan-management-api/latest/vim.cluster.VsanObjectSystem.html), [Stretched cluster](https://developer.broadcom.com/xapis/vsan-management-api/latest/vim.cluster.VsanVcStretchedClusterSystem.html), [официальный пример переноса сессии](https://github.com/vmware/pyvmomi/blob/master/vsanapiutils.py). Страницы `latest` могут описывать новые версии и сами по себе не доказывают наличие каждого поля в 8.0 U3.

Используется SOAP через HTTPS, cookie явно переносится из `/sdk` в `/vsanHealth`; отдельно существование аналогичных маршрутов в REST/JSON не предполагается. Login/Logout и временный View меняют состояние API-сессии, но не конфигурацию VMware. При аварийном прерывании сессия может дожить до таймаута. Взаимодействие проверено с одним vCenter 8.0.3; ESA и ненулевые причины resync не проверены.
