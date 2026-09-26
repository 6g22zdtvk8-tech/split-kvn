# Автоматическая установка VPN Manager

Руководство по созданию "мастер-флешки" для автоматической установки VPN Manager на новых роутерах Keenetic. Описывает текущую реализацию и практические шаги для офлайн‑установки.

## Обзор

После подготовки флешки процесс установки на новом роутере сводится к (офлайн‑сценарий):
1. Подготовить флешку на ПК: `ext4`, папка `install` с архивом Entware, `etc/initrc` и проект в корне флешки (он станет `/opt`)
2. Вставить флешку в роутер
3. В разделе «OPKG» указать флешку как носитель OPKG и сохранить
4. Дождаться установки Entware, затем автоматической установки VPN Manager (~5 минут)

Сценарий рассчитан на «чистый» роутер без Entware — установка Entware выполняется офлайн из архива в папке `install`. Автоскрипт запускается уже после появления `/opt` (корень флешки монтируется как `/opt`).
Важно: архив установщика Entware должен лежать на флешке в `install`, иначе установка не начнётся.

## Как это устроено

### Решение проблемы с dnsmasq (порт 53)

**Проблема:** Keenetic использует свой DNS-прокси (`ndnproxy`) на порту 53. Наш dnsmasq не мог занять тот же порт.

**Решение (v2):** dnsmasq теперь работает на **порту 5353**, а iptables перенаправляет весь DNS-трафик (dpt:53) на порт 5353. Это полностью обходит конфликт с `ndnproxy`.

**Изменения:**
- `install-singbox.sh`: добавлен `port=5353` в конфигурацию dnsmasq
- `S98singbox-rules`: все `--to-ports 53` изменены на `--to-ports 5353`
- `enable_dns_override()` больше не вызывается — не нужен

**Преимущества:**
- Не зависим от `ndnproxy` и его поведения
- Не нужен `opkg dns-override`
- Работает сразу после установки

---

### Архитектура

**Правильная последовательность:**
1. Keenetic монтирует флешку как `/opt`
2. Keenetic вызывает наш `initrc`
3. `initrc` запускает `doinstall` → `/opt/bin/install` (стандартный Entware-инсталлер)
4. `initrc` **ждёт** завершения Entware-инсталлера (пока `/opt/bin/install` не удалит себя)
5. `initrc` запускает `rc.unslung start` (сервисы Entware)
6. `initrc` удаляет себя (Entware зарегистрировал rc.unslung)
7. `initrc` запускает `S01autoinstall` (VPN Manager)

**Ключевое изменение в `initrc`:**
```bash
# Ждём завершения install (он удаляет себя в конце)
while [ -f /opt/bin/install ]; do
    sleep 5
done
```

### Что делает Entware-инсталлер

Стандартный `/opt/bin/install` выполняет:
- `opkg update`
- `opkg install libgcc libc ... opt-ndmsv2 dropbear busybox`
- Генерация SSH-ключей
- Запуск dropbear
- Регистрация `rc.unslung` как init-скрипта

Пакет **`opt-ndmsv2`** приносит критически важные файлы:
- `/opt/etc/init.d/rc.func` — библиотека функций для init-скриптов
- `/opt/etc/init.d/rc.unslung` — главный скрипт запуска сервисов

Без них **ни один сервис Entware не стартует** (lighttpd, dnsmasq, dropbear...).

---

## Способ 1: S01autoinstall (рекомендуемый)

### Шаг 1: Подготовить скрипт автоустановки

Скрипт лежит в репозитории: `scripts/S01autoinstall`. Его нужно скопировать в `/opt/etc/init.d/S01autoinstall`.

```bash
#!/bin/sh
# Автоустановка VPN Manager после первого запуска Entware
# Выполняется ОДИН раз при первой загрузке

MARKER="/opt/etc/.vpn-manager-installed"
INSTALLER="/opt/vpn-manager-installer/install-singbox.sh"
LOG="/tmp/autoinstall.log"

log_msg() {
    echo "$(date): $1" >> "$LOG" 2>/dev/null
    logger -t vpn-manager-autoinstall "$1" 2>/dev/null
}

# Если /opt/var/log уже существует — пишем туда, но не создаём директорию сами.
if [ -d /opt/var/log ]; then
LOG="/opt/var/log/autoinstall.log"
fi

log_msg "S01autoinstall started."

# Если уже установлено — выходим
if [ -f "$MARKER" ]; then
    log_msg "VPN Manager already installed, exiting."
    exit 0
fi

# Ждём появления Entware (opkg/rc.unslung)
entware_wait=0
while [ $entware_wait -lt 60 ]; do
    if [ -x /opt/bin/opkg ] || [ -x /opt/etc/init.d/rc.unslung ]; then
        log_msg "Entware ready."
        break
    fi
    sleep 2
    entware_wait=$((entware_wait + 1))
done

# opkg использует /opt/tmp для lock-файлов
if mkdir -p /opt/tmp 2>/dev/null; then
    log_msg "/opt/tmp is ready."
else
    log_msg "Failed to create /opt/tmp, waiting..."
    tmp_wait=0
    while [ $tmp_wait -lt 60 ]; do
        if [ -d /opt/tmp ]; then
            log_msg "/opt/tmp is ready."
            break
        fi
        sleep 2
        tmp_wait=$((tmp_wait + 1))
    done
fi

# Ждём готовности сети (Entware нужен интернет для opkg)
sleep 10

# Проверяем доступность интернета
wait_count=0
while [ $wait_count -lt 60 ]; do
    if ping -c 1 8.8.8.8 >/dev/null 2>&1; then
        break
    fi
    log_msg "Waiting for network... ($wait_count/60)"
    sleep 5
    wait_count=$((wait_count + 1))
done

# Запускаем установку
installer_wait=0
while [ $installer_wait -lt 60 ]; do
    # На Windows теряется +x, фиксируем перед проверкой
    if [ -f "$INSTALLER" ] && [ ! -x "$INSTALLER" ]; then
        chmod +x "$INSTALLER" 2>/dev/null
    fi
    if [ -x "$INSTALLER" ]; then
        break
    fi
    sleep 2
    installer_wait=$((installer_wait + 1))
done

if [ -x "$INSTALLER" ]; then
    log_msg "Starting VPN Manager auto-install"
    "$INSTALLER" >> "$LOG" 2>&1
    
    if [ $? -eq 0 ]; then
        touch "$MARKER"
        log_msg "VPN Manager installed successfully"
        
        # Удаляем себя (одноразовый скрипт)
        rm -f /opt/etc/init.d/S01autoinstall
    else
        log_msg "Installation failed, will retry on next boot"
    fi
else
    log_msg "Installer not found: $INSTALLER"
fi
```

### Шаг 2: Сделать исполняемым

```bash
chmod +x /opt/etc/init.d/S01autoinstall
```

### Шаг 3: Подготовить структуру флешки

Флешка должна быть отформатирована в ext4 и содержать:

```
USB (ext4)/
├── .install                    ← Создаётся Keenetic для Entware
├── install/                    ← Оффлайн-установщик Entware
│   └── aarch64-installer.tar.gz
├── etc/
│   ├── initrc                  ← Хук OPKG: запускает S01autoinstall
│   └── init.d/
│       └── S01autoinstall      ← Наш скрипт автоустановки
├── vpn-manager-installer/      ← Наш проект (будет доступен как /opt/vpn-manager-installer)
│   ├── install-singbox.sh
│   ├── config/
│   ├── scripts/
│   └── web/
└── (остальные каталоги Entware появятся после установки)
```

### Шаг 4: Автоматизация подготовки флешки

В репозитории есть скрипт `scripts/create-master-usb.sh`, который подготавливает флешку:

```bash
# пример для Linux/роутера (USB смонтирован в /tmp/mnt/USB)
./scripts/create-master-usb.sh /tmp/mnt/USB ./entware/aarch64-installer.tar.gz
```

**Для Windows (PowerShell):**

Флешка должна быть отформатирована в ext4 (используйте DiskGenius или Linux).

**Способ 1: Скрипт (рекомендуется)**

```powershell
# Одна флешка
.\usb-ready\prepare-usb.ps1 F

# Несколько флешек одной командой
.\usb-ready\prepare-usb.ps1 F G H
```

**Способ 2: Вручную**

```powershell
# Копирование проекта на флешку (замените F:\ на букву вашей флешки)
$src = '.\usb-ready'
$dst = 'F:\'

# Копируем файлы
Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force

# ВАЖНО: Конвертируем CRLF → LF ТОЛЬКО для shell-скриптов
Get-ChildItem -Path $dst -Recurse -File | Where-Object {
    $_.Extension -in @('.sh', '.cgi') -or
    $_.Name -match '^S[0-9]+' -or
    $_.Name -eq 'initrc'
} | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content) {
        $content = $content -replace "`r`n", "`n"
        [System.IO.File]::WriteAllText($_.FullName, $content, [System.Text.Encoding]::UTF8)
        Write-Host "LF: $($_.Name)"
    }
}

Write-Host "OK: $dst"
```

> ⚠️ **Важно:** Только shell-скрипты (`.sh`, `.cgi`, `S*`, `initrc`) требуют Unix-окончания строк (LF). Windows использует CRLF, что вызывает ошибку `exit code 2` при запуске скриптов. Остальные файлы (HTML, CSS, JS, JSON, TXT) работают с любыми окончаниями строк — их не нужно конвертировать.


Пример одной командой для двух флешек на с буквами J и H:

$src = 'C:\path\to\usb-ready'; @('J:\', 'H:\') | ForEach-Object { $dst = $_; Write-Host "Copying to $dst..."; Get-ChildItem $src | ForEach-Object { $target = Join-Path $dst $_.Name; if (Test-Path $target) { Remove-Item -Recurse -Force $target }; Copy-Item -Recurse -Force $_.FullName $dst }; @('etc\initrc', 'etc\init.d\S01autoinstall', 'vpn-manager-installer\scripts\ndmc-postinstall.sh', 'vpn-manager-installer\install-singbox.sh') | ForEach-Object { $p = Join-Path $dst $_; if (Test-Path $p) { $c = Get-Content -Raw $p; $c = $c -replace "`r`n","`n"; [System.IO.File]::WriteAllText($p, $c) } }; Write-Host "OK: $dst" }

### Шаг 5: Создание мастер-флешки из настроенного роутера

На уже настроенном роутере выполнить:

```bash
# 1. Убедиться что VPN Manager установлен и работает

# 2. Создать скрипт автоустановки
cat > /opt/etc/init.d/S01autoinstall << 'EOFSCRIPT'
#!/bin/sh
MARKER="/opt/etc/.vpn-manager-installed"
INSTALLER="/opt/vpn-manager-installer/install-singbox.sh"
LOG="/opt/var/log/autoinstall.log"

[ -f "$MARKER" ] && exit 0

sleep 30

wait_count=0
while [ $wait_count -lt 60 ]; do
    ping -c 1 8.8.8.8 >/dev/null 2>&1 && break
    sleep 5
    wait_count=$((wait_count + 1))
done

if [ -x "$INSTALLER" ]; then
    echo "$(date): Starting VPN Manager auto-install" >> "$LOG"
    "$INSTALLER" >> "$LOG" 2>&1 && touch "$MARKER" && rm -f /opt/etc/init.d/S01autoinstall
fi
EOFSCRIPT
chmod +x /opt/etc/init.d/S01autoinstall

# 3. Удалить маркер (чтобы на новом роутере установка запустилась)
rm -f /opt/etc/.vpn-manager-installed

# 4. Очистить конфиги специфичные для этого роутера
rm -f /opt/etc/sing-box/config.json
rm -f /opt/etc/vpn-manager/active-config
rm -f /opt/etc/vpn-manager/ssserver-credentials.json
rm -rf /opt/etc/vpn-manager/configs/*
rm -rf /opt/etc/vpn-manager/sessions/* /tmp/vpn-manager-sessions/*

# 5. Очистить логи
rm -f /opt/var/log/sing-box.log
rm -f /opt/var/log/autoinstall.log
rm -rf /opt/var/log/vpn-manager/*

# 6. Вынуть текущую флешку, вставить новую (ext4), примонтировать как /tmp/mnt/NEW
# 7. Скопировать весь /opt на новую флешку:
cp -a /opt/* /tmp/mnt/NEW/opt/
```

## Способ 2: Готовый tar-архив

Более простой вариант для клонирования настроенного роутера.

### Создание архива

На настроенном роутере:

```bash
# Остановить сервисы
/opt/etc/init.d/S99sing-box stop
/opt/etc/init.d/S98singbox-rules stop

# Создать архив
tar -czvf /tmp/mnt/USB/entware-vpnmanager-backup.tar.gz -C / opt
```

### Восстановление на новом роутере

После установки базового Entware:

```bash
# Распаковать архив
tar -xzvf /tmp/mnt/USB/entware-vpnmanager-backup.tar.gz -C /

# Перезагрузить сервисы
/opt/etc/init.d/S99sing-box start
/opt/etc/init.d/S98singbox-rules start
```

## Сравнение способов

| Критерий | S01autoinstall | tar-архив |
|----------|----------------|-----------|
| Время подготовки | 10 мин | 5 мин |
| Время установки | ~5 мин (качает пакеты) | ~1 мин |
| Нужен интернет | Да | Нет |
| Разные архитектуры | Да (скачает нужный sing-box) | Нет (только та же архитектура) |
| Свежие пакеты | Да | Нет (версия на момент архивации) |

## Требования

- Флешка отформатирована в **ext4**
- Роутер Keenetic с поддержкой OPKG
- Поддерживается только архитектура **aarch64 (arm64)**; другие (mips, mipsel и т.п.) не рассматриваются
- Архив установщика Entware лежит в `install/` на флешке (оффлайн‑установка)
- Доступ в интернет требуется для установки зависимостей через `opkg` и загрузки `sing-box` (если не используем локальный архив)

## Устранение неполадок

### Установка не запустилась

Проверить лог:
```bash
cat /opt/var/log/autoinstall.log
```

### Где смотреть прогресс установки

- Установка Entware отображается в системном журнале Keenetic (раздел «Диагностика»).
- Установка VPN Manager пишет подробный лог в `/opt/var/log/autoinstall.log`.
- При желании можно добавить `logger` в `S01autoinstall`, чтобы ключевые этапы попадали в системный журнал.

### Нет интернета при первом запуске

Скрипт ждёт сеть до 5 минут. Если не появилась — установка произойдёт при следующей перезагрузке.

### Ошибка "Installer not found"

Убедиться что `vpn-manager-installer/install-singbox.sh` находится в `/opt/vpn-manager-installer/install-singbox.sh` и имеет права на выполнение.
