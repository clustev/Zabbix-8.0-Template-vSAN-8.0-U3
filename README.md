# VMware vSAN by HTTP для Zabbix 8.0

Шаблон собирает vSAN данные через штатные read-only SOAP API vCenter. Один logical host Zabbix представляет vCenter. Для установки импортируйте YAML, привяжите шаблон и задайте URL/учётные данные в macros. Сборка и внешние компоненты при эксплуатации не нужны.

Шаблон не изменяет ESXi, vCenter, vSAN или конфигурацию Zabbix Server/Proxy; не устанавливает VIB/агенты, не включает SSH/SNMP/Shell, не запускает активные проверки и не включает сервисы. Skyline Health читается с `fetchFromCache=true`. Если Performance Service выключен или API не отдаёт метрику, сбор продолжается с доступными данными, а причина показывается диагностикой. Возможности Performance API определяются автоматически.

Собираются inventory, topology, cached Skyline Health, ёмкость и категории объектов, состояния объектов, сводка и выборочные причины resync, дисковое здоровье, SMART, производительность кластера, хостов, OSA-дисков и виртуальных машин (IOPS, throughput, latency). Метрики недоступности не заменяются нулями. Для подробного состава и ограничений см. [метрики](docs/metrics.md) и [совместимость](docs/compatibility.md).

Стандартные интервалы опроса: inventory/pools — 1h; health — 10m; capacity — 30m; objects — 15m; resync — 5m; topology/performance — 10m; disk health/used/reserved capacity/SMART — 30m; статические характеристики диска — 1d. Интервалы задаются macros шаблона. Все параметры и настройка описаны в [инструкции](docs/installation.md).

## Файлы

- [Шаблон Zabbix YAML](template_vmware_vsan_http.yaml)
- [Исходник сборщика](src/collector.js)
- [Сборка YAML](build.rb)
- [Установка и macros](docs/installation.md)
- [Права](docs/permissions.md)
- [API endpoints](docs/api-endpoints.md)
- [Полный перечень метрик](docs/metrics.md)
- [Архитектура](docs/architecture.md)
- [Совместимость и ограничения](docs/compatibility.md)
- [Диагностика](docs/troubleshooting.md)
- [Журнал изменений](CHANGELOG.md)

## Проверка

Предыдущая редакция импортировалась в Zabbix 8.0.0 и проверялась read-only на vCenter 8.0.3 с OSA; проверялись в том числе отдельные метрики VM, хостов и OSA-дисков. Текущая редакция с более редким опросом и отдельным ежедневным сбором статических характеристик дисков не импортировалась в живой Zabbix. ESA и ненулевой resync в реальной среде не подтверждены; latency требует сверки на конкретной сборке vCenter. Подробности и ограничения — [здесь](docs/validation.md).

Для разработки доступна сборка `ruby build.rb` и проверки из `tests/validation/`. Тестовые ответы синтетические. При HTTPS-сборе сертификат vCenter должен уже доверяться ОС узла Zabbix Server/Proxy; особые CA могут требовать отдельной настройки ОС, подробнее — в документации по установке.
