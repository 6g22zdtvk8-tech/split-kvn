#!/bin/sh

# System monitoring API - CPU, RAM, disk usage
# Returns real-time system metrics

export PATH="/opt/bin:/opt/sbin:/bin:/sbin:/usr/bin:/usr/sbin"
SCRIPT_DIR=$(dirname "$0")
. "$SCRIPT_DIR/common.sh"

# Authorization check
if ! validate_session; then
    json_error "Authorization required" 401
    exit 0
fi

# Main handler
case "$REQUEST_METHOD" in
    GET)
        # CPU Load
        load1=$(cut -d' ' -f1 /proc/loadavg)
        load5=$(cut -d' ' -f2 /proc/loadavg)
        load15=$(cut -d' ' -f3 /proc/loadavg)
        
        # Memory
        mem_total=$(grep MemTotal /proc/meminfo | awk '{print $2}')
        mem_free=$(grep MemFree /proc/meminfo | awk '{print $2}')
        mem_available=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
        mem_buffers=$(grep Buffers /proc/meminfo | awk '{print $2}')
        mem_cached=$(grep Cached /proc/meminfo | head -1 | awk '{print $2}')
        
        # Set defaults
        [ -z "$mem_total" ] && mem_total=0
        [ -z "$mem_free" ] && mem_free=0
        [ -z "$mem_available" ] && mem_available=0
        [ -z "$mem_buffers" ] && mem_buffers=0
        [ -z "$mem_cached" ] && mem_cached=0
        
        # Calculate used memory
        mem_used=$((mem_total - mem_free - mem_buffers - mem_cached))
        
        # Convert to MB
        mem_total_mb=$((mem_total / 1024))
        mem_used_mb=$((mem_used / 1024))
        mem_available_mb=$((mem_available / 1024))
        
        # Calculate percentage
        if [ "$mem_total" -gt 0 ]; then
            mem_percent=$((100 * mem_used / mem_total))
        else
            mem_percent=0
        fi
        
        # Disk
        disk_info=$(df -h /opt 2>/dev/null | tail -1)
        disk_total=$(echo "$disk_info" | awk '{print $2}')
        disk_used=$(echo "$disk_info" | awk '{print $3}')
        disk_free=$(echo "$disk_info" | awk '{print $4}')
        disk_percent=$(echo "$disk_info" | awk '{print $5}' | tr -d '%')
        
        [ -z "$disk_total" ] && disk_total="0"
        [ -z "$disk_used" ] && disk_used="0"
        [ -z "$disk_free" ] && disk_free="0"
        [ -z "$disk_percent" ] && disk_percent=0
        
        # Uptime
        uptime_seconds=$(cut -d'.' -f1 /proc/uptime)
        
        # Build JSON response
        json_success "{\"cpu\":{\"load\":\"${load1}\",\"load1\":\"${load1}\",\"load5\":\"${load5}\",\"load15\":\"${load15}\"},\"memory\":{\"total\":${mem_total_mb},\"used\":${mem_used_mb},\"available\":${mem_available_mb},\"percent\":${mem_percent}},\"disk\":{\"total\":\"${disk_total}\",\"used\":\"${disk_used}\",\"free\":\"${disk_free}\",\"percent\":${disk_percent}},\"uptime\":${uptime_seconds}}"
        ;;
    *)
        json_error "errors.methodNotAllowed" 405
        ;;
esac
