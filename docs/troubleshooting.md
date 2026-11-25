# Диагностика

- `HTTP 401/403` или `missing properties`: проверяйте учётную запись, её видимость и права. Новая сессия создаётся для каждого опроса; повтор — в следующем интервале.
- `HTTP 404/429/5xx`: endpoint, лимиты и состояние vCenter; отдельного backoff нет.
- `HTTP transport or TLS failure`: сеть, прямой HTTPS origin, SAN сертификата и доверие CA на Server/Proxy.
- `Invalid XML response or XML support unavailable`: проверьте XML-поддержку сборки Zabbix и ответ endpoint. Не публикуйте SOAP с секретами.
- `Health cache is stale` или отсутствует timestamp: проверьте штатное обновление Skyline и `{$VSAN.HEALTH.MAX.AGE}`. Шаблон не инициирует health check.
- `Performance Service is disabled`: производительность не поступает; шаблон не включает сервис. Если сервис включён, смотрите список неподдержанных счётчиков, единиц и отсутствующих свежих точек в performance warning.
- `Space overview fields unavailable`: отдельные необязательные поля API отсутствуют. Резерв объектов не является operations reserve или host rebuild reserve.
- SMART warning: поля, диск или совпадение имён host/disk отсутствуют; сырые wear/temperature не следует считать процентами/Celsius без документации устройства.
- Pool warning: неподходящая архитектура, хост не отвечает, список отсутствует либо pool больше одного; смотрите `pools.partial`.
- `No hosts visible for a vSAN cluster`: проверьте видимость и реальное состояние кластера; discovery намеренно не удаляет прежние записи при такой неопределённости.
- `collector has no data`/timeout: проверьте pollers, интервалы, объём и размер инфраструктуры; последовательный обход может не уложиться в timeout.

Тексты ошибок SOAP не копируются в результат, чтобы не раскрывать данные ответа. Проверка проведена на одном живом OSA-кластере; ESA и непустая выборка причин resync требуют отдельной проверки.
