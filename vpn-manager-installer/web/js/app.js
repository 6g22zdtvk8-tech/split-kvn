/**
 * Split-KVN — Frontend Application
 * Version: 1.0.0
 */

(function() {
    'use strict';

    // ============================================
    // Configuration
    // ============================================
    const CONFIG = {
        API_BASE: '/api',
        STATUS_INTERVAL: 60000,     // 60 seconds
        // AmneziaWG disabled — H4 header corruption bug in amneziawg-go
        // See: docs/amneziawg-research.md
        // Tested: 1.5.2, 1.5.3, custom build with v0.2.14-beta-awg-1.5-1
        // All versions have same H4 corruption issue
        AMNEZIAWG_ENABLED: false,
        DEFAULT_LANGUAGE: 'en'
    };

    // Every API call carries X-Requested-With: the router rejects API requests without
    // it, so a page on another site can't drive the panel through a browser on the LAN.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.startsWith(CONFIG.API_BASE + '/') || url.startsWith(location.origin + CONFIG.API_BASE + '/')) {
            init = { ...init, headers: { ...(init.headers || {}), 'X-Requested-With': 'vpn-manager' } };
        }
        return nativeFetch(input, init);
    };

    // ============================================
    // Internationalization (i18n)
    // ============================================
    const TRANSLATIONS = {
        en: {
            // Header
            'app.title': 'Split-KVN',
            'header.autostart': 'Autostart',
            'header.language': 'Language',
            'header.vpnActive': 'VPN active',
            'header.vpnStopped': 'VPN stopped',
            'deviceId.copied': 'Device ID copied to clipboard',
            'time.h': 'h',
            'time.min': 'min',
            'time.s': 's',
            'time.d': 'd',
            'time.ago': 'ago',
            
            // Tabs
            'tab.vpn': 'VPN Configs',
            'tab.domains': 'Domains',
            'tab.subnets': 'IP Subnets',
            'tab.server': 'VPN Server',
            
            // Subtabs
            'subtab.tcpudp': 'TCP + UDP',
            'subtab.udponly': 'UDP-only',
            
            // VPN Tab
            'vpn.title': 'VPN Configurations',
            'vpn.status.running': 'Running',
            'vpn.status.stopped': 'Stopped',
            'vpn.status.notConfigured': 'Not configured',
            'vpn.addConfig': 'Add Configuration',
            'vpn.addSubscription': 'Add Subscription',
            'vpn.noConfigs': 'No VPN configurations',
            'vpn.addFirst': 'Add your first VPN configuration to get started',
            'vpn.activate': 'Activate',
            'vpn.deactivate': 'Deactivate',
            'vpn.edit': 'Edit',
            'vpn.delete': 'Delete',
            'vpn.active': 'Active',
            'vpn.routingPolicy': 'Routing policy',
            'vpn.stop': 'Stop',
            'vpn.start': 'Start',
            'vpn.start.title': 'Start VPN with last active configuration',
            'vpn.stop.title': 'Stop VPN completely',
            'vpn.checkIp': 'Check IP',
            'vpn.checkIp.title': 'Check current IP address',
            'vpn.import': 'Import',
            'vpn.import.title': 'Import from URL',
            'vpn.export': 'Export',
            'vpn.export.title': 'Export subscriptions and configurations',
            'exportConfigs.title': 'Export configurations',
            'exportConfigs.description': 'Pick what to export. A subscription is exported as its own link — the servers inside it are restored from that link, so they are not listed separately.',
            'exportConfigs.selectAll': 'Select all',
            'exportConfigs.subscriptions': 'Subscriptions',
            'exportConfigs.kindSubscription': 'subscription',
            'exportConfigs.standalone': 'Separate configurations',
            'exportConfigs.servers': '{n} server(s)',
            'exportConfigs.asFile': 'file',
            'exportConfigs.build': 'Export',
            'exportConfigs.back': 'Back',
            'exportConfigs.copyAll': 'Copy all',
            'exportConfigs.linksLabel': 'Links',
            'exportConfigs.filesLabel': 'Available as files',
            'exportConfigs.filesHint': 'These protocols have no link form, so they are exported as .conf files.',
            'exportConfigs.download': 'Download',
            'exportConfigs.copied': 'Copied to clipboard',
            'exportConfigs.copyFailed': 'Could not copy — select the text and copy it manually',
            'exportConfigs.selectAtLeastOne': 'Pick at least one item',
            'exportConfigs.nothing': 'Nothing to export',
            'exportConfigs.noLinks': 'The picked items have no link form — see the files below.',
            'vpn.add': 'Add',
            'vpn.servers': 'VPN Servers',
            'vpn.activeConfig': 'Active configuration',
            'vpn.uptime': 'Uptime',
            'vpn.server': 'Server',
            'vpn.configsCount': 'Configurations',
            'vpn.domainsCount': 'Domains',
            'vpn.upload': 'UPLOAD',
            'vpn.download': 'DOWNLOAD',
            'vpn.connections': 'CONNECTIONS',
            'vpn.autostart': 'Autostart on boot',
            
            // Routing policies
            'routing.direct': 'All traffic direct, VPN not used',
            'routing.split': 'Everything direct, the list set goes through VPN',
            'routing.vpnprimary': 'Everything through VPN, the list set goes direct',
            'routing.fullvpn': 'Full VPN (all traffic)',
            'routing.disabled': 'VPN disabled for this segment',
            'routing.policyLabel': 'Routing mode',
            'routing.policy.direct': 'Direct',
            'routing.policy.split': 'Direct primary',
            'routing.policy.vpnprimary': 'VPN primary',
            'routing.policy.fullvpn': 'Full VPN',
            'routing.policy.fullvpnShort': 'VPN',
            
            // Segments
            'segments.title': 'Network Segments',
            'segments.refresh': 'Refresh',
            'segments.name': 'Segment',
            'segments.network': 'Network',
            'segments.policy': 'Policy',
            'segments.devices': 'devices',
            
            // Domains
            'domains.title': 'Domain Routing',
            'domains.description': 'Domains routed through VPN',
            'domains.tcpudp.title': 'TCP+UDP Domains',
            'domains.udponly.title': 'UDP-only Domains',
            'domains.placeholder': 'Enter domains, one per line',
            'domains.save': 'Save',
            'domains.saved': 'Domain list saved',
            'domains.hint': 'Enter domain names without http://, one per line. Example: youtube.com',
            
            // Subnets
            'subnets.title': 'IP Subnet Routing',
            'subnets.description': 'IP subnets routed through VPN',
            'subnets.tcpudp.title': 'TCP+UDP Subnets',
            'subnets.udponly.title': 'UDP-only Subnets',
            'subnets.placeholder': 'Enter subnets in CIDR format, one per line',
            'subnets.save': 'Save',
            'subnets.saved': 'Subnet list saved',
            'subnets.hint': 'Enter subnets in CIDR format. Example: 8.8.8.0/24',
            
            // Auto-update lists
            'autoupdate.title': 'Auto-update Lists',
            'autoupdate.checkbox': 'Automatic domain and subnet list supplementation',
            'autoupdate.source': 'Source',
            'autoupdate.interval': 'Update interval',
            'autoupdate.lastUpdate': 'Last update',
            'autoupdate.never': 'Never',
            'autoupdate.updateNow': 'Update now',
            'autoupdate.hours3': 'Every 3 hours',
            'autoupdate.hours6': 'Every 6 hours',
            'autoupdate.hours12': 'Every 12 hours',
            'autoupdate.hours24': 'Every 24 hours',
            'autoupdate.schedule3': 'Schedule: 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00',
            'autoupdate.schedule6': 'Schedule: 00:00, 06:00, 12:00, 18:00',
            'autoupdate.schedule12': 'Schedule: 00:00, 12:00',
            'autoupdate.schedule24': 'Schedule: 04:00 (once a day)',
            'autoupdate.enabled': 'Auto-update enabled',
            'autoupdate.disabled': 'Auto-update disabled',
            'autoupdate.updating': 'Updating...',
            'autoupdate.success': 'Lists updated successfully',
            'autoupdate.viewFiles': 'View downloaded lists',
            'autoupdate.transferToLocal': 'Transfer to local lists',
            'autoupdate.transferToLocalTitle': 'Copy currently downloaded remote lists into your local lists and disable auto-update',
            
            // Server export/import users
            'server.export': 'Export',
            'server.exportTitle': 'Export VPN server users to a JSON file',
            'server.import': 'Import',
            'server.importTitle': 'Import VPN server users from a JSON file',
            'exportUsers.title': 'Export VPN server users',
            'exportUsers.description': 'Pick the users to export. The downloaded JSON file contains user names and UUIDs. You can re-import it later (e.g. after reinstalling VPN Manager) to restore client connectivity without changing client configs.',
            'exportUsers.selectAll': 'Select all',
            'exportUsers.download': 'Download',
            'exportUsers.downloadStarted': 'Download started',
            'exportUsers.selectAtLeastOne': 'Select at least one user',
            'exportUsers.noUsers': 'No users to export',
            'importUsers.title': 'Import VPN server users',
            'importUsers.description': 'Upload a JSON file previously produced by Export. Existing users with matching names follow the conflict policy below.',
            'importUsers.fileLabel': 'JSON file with users',
            'importUsers.modeLabel': 'If a user with the same name already exists:',
            'importUsers.modeSkip': 'Skip (keep existing)',
            'importUsers.modeOverwrite': 'Overwrite UUID',
            'importUsers.import': 'Import',
            'importUsers.previewTitle': 'File contains {n} user(s):',
            'importUsers.invalidFile': 'Not a valid VPN Manager users export file',
            'importUsers.pickFile': 'Pick a file first',
            'importUsers.summary': 'Added: {added}, overwritten: {overwritten}, skipped: {skipped}, invalid: {invalid}',
            
            // IPSet viewer
            'ipset.viewBtn': 'IPSet',
            'ipset.viewTitle': 'View kernel ipsets and warm-up domains',
            'ipset.title': 'IPSet contents',
            'ipset.groupDomains': 'Domains (filled by dnsmasq)',
            'ipset.groupSubnets': 'Subnets (filled from your subnet lists)',
            'ipset.description': 'Live snapshot of the kernel-level ipsets that drive VPN routing. Domain ipsets are filled by dnsmasq as queries come in; subnet ipsets are loaded from your subnet lists.',
            'ipset.warmupBtn': 'Warm-up domains',
            'ipset.warmupStarting': 'Starting warm-up…',
            'ipset.warmupRunning': 'Warm-up in progress…',
            'ipset.warmupFinished': 'Warm-up finished',
            'ipset.warmupStarted': 'Warm-up started in background',
            'ipset.notLoaded': '(ipset not created)',
            'ipset.truncated': 'truncated, showing first {n} entries',
            'ipset.downloadBtn': 'Download snapshot',
            'ipset.downloadTitle': 'Download a full text snapshot of all ipsets (no truncation)',
            'ipset.downloadStarted': 'Snapshot download started',
            
            // Transfer remote → local modal
            'transferToLocal.title': 'Transfer remote lists to local',
            'transferToLocal.description': 'Copy the currently downloaded remote lists of both sets (ruunblockdomains and ruservices) into your local lists. After transfer, automatic updates will be turned off — your local lists become the only source.',
            'transferToLocal.scopeLabel': 'Scope',
            'transferToLocal.scopeAll': 'all lists (domains and subnets, TCP+UDP and UDP-only)',
            'transferToLocal.scopeDomains': 'domains (TCP+UDP and UDP-only)',
            'transferToLocal.scopeSubnets': 'subnets (TCP+UDP and UDP-only)',
            'transferToLocal.modeReplace': 'Replace local lists with remote',
            'transferToLocal.modeAppend': 'Append remote to existing local lists',
            'transferToLocal.warning': 'A backup of the previous local file is kept in /opt/etc/vpn-manager/backups (last 5).',
            'transferToLocal.confirm': 'Transfer',
            'transferToLocal.success': 'Transferred {n} entries from {f} files; auto-update disabled',
            
            // Failover (auto-switch VPN configs)
            'failover.label': 'Auto-switch server on failure',
            'failover.modeOff': 'Off',
            'failover.modeSubscription': 'Within current subscription',
            'failover.modeAll': 'Across all configs',
            'failover.interval': 'Check interval',
            'failover.lastCheck': 'Last check',
            'failover.checkNow': 'Check now',
            'failover.checkNowTitle': 'Trigger health check immediately',
            'failover.recentSwitches': 'Recent switches',
            'failover.statusOk': 'OK',
            'failover.statusFailed': 'FAILED',
            'failover.noActive': 'no active config',
            'failover.toastOk': 'VPN tunnel is healthy',
            'failover.toastFailed': 'VPN tunnel is unreachable',
            'failover.toastNoActive': 'No active VPN config to check',
            'failover.toastDone': 'Health check completed',
            'failover.toastError': 'Health check request failed: ',
            'failover.checking': 'Checking…',
            
            // Multi-connection mode (several servers at once, multi.cgi)
            'multi.modeSingle': 'One connection',
            'multi.modeSingleWhat': 'one server at a time',
            'multi.modeMulti': 'Several connections',
            'multi.modeMultiWhat': 'several servers, switching on failure',
            'multi.switchedMulti': 'Several-connections mode is on',
            'multi.switchedSingle': 'One-connection mode is on',
            'multi.tileTitle': 'Several connections',
            'multi.counter': '{n} of {limit}',
            'multi.counterTitle': 'Selected servers / limit',
            'multi.checkNow': 'Check now',
            'multi.checkNowTitle': 'Check every server now (takes up to 15 s)',
            'multi.checking': 'Checking…',
            'multi.lastCheck': 'Last check',
            'multi.never': 'not yet',
            'multi.empty': 'No servers selected. Tick servers in the list below.',
            'multi.statusMain': 'Main',
            'multi.statusReserve': 'Reserve',
            'multi.statusDown': 'Not responding',
            'multi.statusUnknown': 'Not checked',
            'multi.carrying': 'Traffic',
            'multi.carryingTitle': 'Traffic goes through this server now',
            'multi.makePrimary': 'Make main server',
            'multi.isPrimary': 'Main server',
            'multi.remove': 'Remove from selection',
            'multi.undoRemove': 'Keep this server',
            'multi.pendingAdd': 'will be added',
            'multi.pendingRemove': 'will be removed',
            'multi.ms': 'ms',
            'multi.truncated': '{n} servers of the ticked subscriptions did not fit into the limit of {limit} and are not used',
            'multi.subFit': '{fit} of {n} fit',
            'multi.subFitTitle': 'Only part of this subscription fits into the limit of {limit} servers',
            'multi.countryHint': 'Servers of one country work best together: sites see the same location when the server changes.',
            'multi.selectSub': 'Tick all servers of this subscription',
            'multi.selectServer': 'Use this server',
            'multi.selectedCount': '{n} selected',
            'multi.wgDisabled': 'WireGuard and AmneziaWG cannot be combined with other servers. Use them in one-connection mode.',
            'multi.wgShort': 'one-connection mode only',
            'multi.limitReached': 'Limit reached: up to {limit} servers',
            'multi.subTooBig': 'Subscription “{name}” has {n} servers, only {free} more fit (limit {limit}). Tick the servers you need one by one.',
            'multi.pending': 'Selected {n} of {limit} · not applied yet',
            'multi.pendingEmpty': 'Nothing selected · tick at least one server',
            'multi.applyNote': 'VPN restarts: 2–3 s without connection',
            'multi.apply': 'Apply',
            'multi.applying': 'Applying…',
            'multi.reset': 'Cancel',
            'multi.applied': 'Selection applied',
            'multi.primarySet': 'Main server changed',
            'multi.checkDone': 'Check completed',
            'multi.loadError': 'Could not load the several-connections state: ',
            'multi.errors.limit': 'Too many servers selected: the limit is exceeded',
            'multi.errors.empty': 'Select at least one server',
            'multi.errors.wireguard': 'WireGuard and AmneziaWG cannot be used in several-connections mode',
            'multi.errors.notFound': 'A selected server no longer exists. Refresh the page.',
            'multi.errors.apply': 'Could not build the configuration for the selected servers',
            'multi.errors.start': 'The configuration was applied, but the VPN did not start',
            
            // Remote lists modal
            'remoteLists.title': 'Downloaded Domain and Subnet Lists',
            'remoteLists.tcpudpDomains': 'TCP+UDP Domains',
            'remoteLists.udpDomains': 'UDP Domains',
            'remoteLists.tcpudpSubnets': 'TCP+UDP Subnets',
            'remoteLists.udpSubnets': 'UDP Subnets',
            
            // VPN Server
            'server.title': 'VPN Server',
            'server.status': 'Status',
            'server.running': 'Running',
            'server.stopped': 'Stopped',
            'server.start': 'Start',
            'server.stop': 'Stop',
            'server.restart': 'Restart',
            'server.port': 'Port',
            'server.method': 'Method',
            'server.serverKey': 'Server Key',
            'server.protocol': 'Protocol',
            'server.users': 'Users',
            'server.addUser': 'Add User',
            'server.noUsers': 'No users configured',
            'server.username': 'Username',
            'server.password': 'Password',
            'server.showQR': 'Show QR',
            'server.copyLink': 'Copy Link',
            'server.deleteUser': 'Delete User',
            
            // IPv6
            'ipv6.title': 'IPv6 Settings',
            'ipv6.enabled': 'IPv6 Enabled',
            'ipv6.disabled': 'IPv6 Disabled',
            'ipv6.enable': 'Enable IPv6',
            'ipv6.disable': 'Disable IPv6',
            'ipv6.pending': 'Pending...',
            
            // Modals
            'modal.close': 'Close',
            'modal.save': 'Save',
            'modal.cancel': 'Cancel',
            'modal.confirm': 'Confirm',
            'modal.delete': 'Delete',
            
            // Config modal
            'configModal.titleAdd': 'Add VPN Configuration',
            'configModal.titleEdit': 'Edit VPN Configuration',
            'configModal.name': 'Name',
            'configModal.namePlaceholder': 'My VPN server',
            'configModal.server': 'Server address',
            'configModal.serverPlaceholder': 'example.com or 1.2.3.4',
            'configModal.port': 'Port',
            'configModal.protocol': 'Protocol',
            'configModal.importLink': 'Or paste a link',
            'configModal.importPlaceholder': 'ss://, vless://, vmess://, trojan://, wg://',
            'configModal.required': '*',
            
            // Config modal - IPv6
            'configModal.ipv6Enable': 'Enable IPv6',
            'configModal.ipv6Hint': 'Enables IPv6 on router when this configuration is activated. Disabled by default — not all VPN servers support IPv6.',
            'configModal.ipv6Warning': '⚠️ Change will apply within 1 minute after saving',
            
            // Config modal - Shadowsocks
            'configModal.password': 'Password',
            'configModal.passwordPlaceholder': 'Shadowsocks password',
            'configModal.encryptionMethod': 'Encryption method',
            'configModal.udpOverTcp': 'UDP over TCP',
            'configModal.udpOverTcpHint': 'Enable if server does not support native UDP. Disable for better VoIP performance (WhatsApp calls on PC).',
            'configModal.showPassword': 'Show password',
            
            // Config modal - VLESS
            'configModal.vlessInfo': 'sing-box Extended: Supports TCP, WebSocket, gRPC, XHTTP transports.',
            'configModal.flow': 'Flow',
            'configModal.flowNone': 'None',
            'configModal.flowVision': 'xtls-rprx-vision (recommended)',
            'configModal.security': 'Security',
            
            // Config modal - VMess
            'configModal.encryption': 'Encryption',
            
            // Config modal - Trojan
            'configModal.trojanPasswordPlaceholder': 'Trojan password',
            'configModal.skipCertVerify': 'Skip certificate verification',
            
            // Config modal - WireGuard
            'configModal.privateKey': 'Private Key',
            'configModal.peerPublicKey': 'Peer Public Key',
            'configModal.localAddress': 'Local address',
            'configModal.localAddressHint': 'Client IP address in WireGuard network',
            'configModal.presharedKey': 'Pre-shared Key',
            'configModal.optional': 'Optional',
            'configModal.showKey': 'Show key',
            
            // Subscription modal
            'subModal.titleAdd': 'Add Subscription',
            'subModal.titleEdit': 'Edit Subscription',
            'subModal.name': 'Subscription name',
            'subModal.url': 'Subscription URL',
            'subModal.update': 'Update subscription',
            
            // Logs
            'logs.title': 'Logs',
            'logs.singbox': 'sing-box',
            'logs.boot': 'Boot',
            'logs.autoinstall': 'Auto-Install',
            'logs.installer': 'Installer',
            'logs.vpnmanager': 'Split-KVN',
            'logs.refresh': 'Refresh',
            'logs.download': 'Download',
            'logs.clear': 'Clear',
            
            // Auth
            'auth.title': 'Authorization',
            'auth.password': 'Password',
            'auth.login': 'Login',
            'auth.logout': 'Logout',
            'auth.changePassword': 'Change password',
            'auth.newPassword': 'New password',
            'auth.confirmPassword': 'Confirm password',
            'auth.setPassword': 'Set Password',
            'auth.wrongPassword': 'Wrong password',
            'auth.passwordChanged': 'Password changed successfully',
            'auth.firstLogin': 'First login. Please set a password.',
            
            // Common / Actions
            'actions.copy': 'Copy',
            'actions.retry': 'Retry',
            'common.settings': 'Settings',
            'vpn.status': 'VPN Status',
            'common.loading': 'Loading...',
            'common.error': 'Error',
            'common.success': 'Success',
            'common.warning': 'Warning',
            'common.info': 'Info',
            'common.yes': 'Yes',
            'common.no': 'No',
            'common.on': 'On',
            'common.off': 'Off',
            'common.enabled': 'Enabled',
            'common.disabled': 'Disabled',
            'common.apply': 'Apply',
            'common.reset': 'Reset',
            'common.refresh': 'Refresh',
            'common.actions': 'Actions',
            'time.h': 'h',
            'time.min': 'min',
            
            // Errors
            'error.network': 'Network error',
            'error.server': 'Server error',
            'error.auth': 'Authentication required',
            'error.unknown': 'Unknown error',
            
            // Auth additional
            'auth.username': 'Username',
            'auth.forgotPassword': 'Forgot password?',
            'auth.recoveryTitle': 'Access Recovery',
            'auth.recoverySubtitle': 'Enter recovery code',
            'auth.recoveryCode': 'Recovery code',
            'auth.recoveryHint': 'The code you saved when setting your password',
            'auth.recover': 'Recover access',
            'auth.backToLogin': '← Back to login',
            'auth.changePasswordTitle': 'Change Password',
            'auth.changePasswordSubtitle': 'Required on first login',
            'auth.passwordMinLength': 'Minimum 8 characters',
            'auth.setupTitle': 'Access Setup',
            'auth.setupSubtitle': 'Choose authorization mode',
            'auth.localOnlyInfo': 'Split-KVN is accessible only from the local network of the router. Internet access is not possible.',
            'auth.noPassword': 'No password',
            'auth.noPasswordDesc': 'Quick access without authorization',
            'auth.setPasswordDesc': 'Protection against unauthorized access',
            
            // Onboarding
            'onboarding.tip': '💡 Tip',
            'onboarding.setPasswordHint': 'You can set a password to protect Split-KVN',
            'onboarding.gotIt': 'Got it',
            
            // VPN additional
            'vpn.loadingConfigs': 'Loading configurations...',
            'vpn.autostartTooltip': 'Automatically start VPN on router boot',
            
            // Domains additional
            'domains.editorHint': 'One domain per line. Subdomains are included automatically.',
            'domains.udponly.hint': 'One domain per line. TCP traffic to these domains will NOT go through VPN.',
            'domains.tcpudp.placeholder': '# TCP+UDP domains - all traffic through VPN\n# One domain per line:\nyoutube.com\nnetflix.com\nopenai.com',
            'domains.udponly.placeholder': '# UDP-only domains - only UDP through VPN\n# TCP to these domains goes directly\ndiscord.com\ntwitch.tv\nzoom.us',
            
            // Subnets additional
            'subnets.editorHint': 'Format: CIDR (e.g., 157.240.0.0/16). One address per line.',
            'subnets.udponly.hint': 'Format: CIDR. TCP traffic to these subnets will NOT go through VPN.',
            'subnets.tcpudp.placeholder': '# IP subnets for TCP+UDP routing\n# CIDR format:\n157.240.0.0/16\n31.13.0.0/16',
            'subnets.udponly.placeholder': '# IP subnets for UDP-only routing\n# TCP to these addresses goes directly\n# Example for Telegram:\n# 91.108.4.0/22',
            
            // Common additional
            'common.upload': 'Upload',
            'common.download': 'Download',
            'common.uploadFile': 'Upload from file',
            'common.downloadFile': 'Download to file',
            
            // Server additional
            'server.description': 'VPN Server allows external connections to the router. Client traffic is routed by the same rules as local devices. To connect from the internet, you need to open port. For advanced port forwarding, use the router web interface.',
            'server.credentials': 'Connection Credentials',
            'server.usernameHint': 'Latin letters, digits, - and _',
            'server.port': 'Server Port',
            'server.portLabel': 'VPN Server Port',
            'server.portHint': 'Valid values: 1024-65535. After changing port, all connected VPN clients will lose connection and need to reconnect with new port.',
            'server.portChangeWarning': 'All connected VPN clients will lose connection. They will need to reconfigure with new port {port}. Continue?',
            
            // Settings
            'settings.auth': 'Authorization',
            'settings.authHint': 'Split-KVN is only accessible from the local network of the router.',
            'settings.authDisabled': 'Authorization is disabled. Any user on the local network has access.',
            'settings.enablePassword': 'Enable password',
            'settings.disablePassword': 'Disable password',
            'settings.currentPassword': 'Current password',
            'settings.webInterface': 'Web Interface',
            'settings.webPort': 'Split-KVN Port',
            'settings.changePort': 'Change',
            'settings.restarting': 'Restarting...',
            'settings.portHint': 'Valid values: 1024-65535. After changing port, you will need to navigate to the new address.',
            'settings.updates': 'Updates',
            'settings.autoUpdate': 'Install updates automatically',
            'settings.updateInstalled': 'Installed:',
            'settings.updateAvailable': 'Available:',
            'settings.updateCheck': 'Check',
            'settings.updateNow': 'Update now',
            'settings.updateSource': 'Update source',
            'settings.updateSourceHint': 'Address of the published release manifest. Empty means updates are switched off entirely.',
            'settings.updateHeld': 'This release is waiting to be cleared for rollout. "Update now" installs it anyway.',
            'settings.updateRunning': 'Updating, usually under a minute. The panel may reload briefly.',
            'settings.updateNone': 'No newer release published.',
            'settings.updateNoSource': 'Update source is not set.',
            'settings.confirmUpdateNow': 'Install the available release now? A backup is taken first and rolled back if it fails.',
            'updateFail.unreachable': 'Could not reach the update source.',
            'updateFail.badManifest': 'The update source answered with something unreadable.',
            'updateFail.noSource': 'Update source is not set.',
            'updateFail.download': 'The release archive could not be downloaded.',
            'updateFail.checksum': 'Checksum did not match — the archive was refused.',
            'updateFail.archive': 'The archive is not a valid installer — nothing was changed.',
            'updateFail.backup': 'Backup failed, so the update was not started.',
            'updateFail.install': 'Installation failed and was rolled back.',
            'updateFail.selfCheck': 'The router did not pass its check after the update and was rolled back.',
            'updateFail.noSha': 'sha256sum is missing on the router, unverified code is refused.',
            'updateFail.tooBig': 'The archive is larger than expected and was refused.',
            'settings.updateCheckedAt': 'Checked: {time}',
            'settings.systemInfo': 'System Information',
            'settings.version': 'Version:',
            'settings.uptime': 'System uptime:',
            'settings.memory': 'Memory:',
            'settings.disk': 'Disk /opt:',
            'settings.portChangeTitle': '⚠️ Web Interface Port Change',
            'settings.portChangeMessage': 'After saving, Split-KVN will be available at the new address:',
            'settings.portChangeNote': 'This page will stop working. You will need to navigate to the new address.',
            'settings.saveAndRedirect': 'Save and redirect',
            'settings.portChangeSuccess': '✅ Port changed',
            'settings.portChangeNowAvailable': 'Split-KVN is now available at:',
            'settings.autoRedirect': 'Auto-redirect in',
            'settings.seconds': 'sec',
            'settings.redirectNow': 'Redirect now',
            'settings.remoteLists': 'Remote Lists Source',
            'settings.listsSourceUrl': 'Base URL for remote lists',
            'settings.save': 'Save',
            'settings.resetToDefault': 'Reset',
            'settings.listsSourceWarning': '⚠️ Warning: The remote source must contain 4 text files with exact names: tcp_udp_domains.txt, udp_domains.txt, tcp_udp_subnets.txt, udp_subnets.txt. If remote lists are unavailable, routing will use local lists only (empty by default).',
            'settings.confirmResetListsSource': 'Reset remote lists source URL to default?',
            'settings.dangerZone': '⚠️ Danger Zone',
            'settings.dangerZoneDescription': 'Advanced settings that can break DNS and VPN functionality. Only change if you know what you\'re doing.',
            'settings.dnsmasqPort': 'Internal dnsmasq Port',
            'settings.dnsmasqPortWarning': '🔴 CRITICAL: This port is used internally for DNS routing. Changing it requires full system restart (dnsmasq, iptables, sing-box). Incorrect configuration may break all DNS resolution. Default value is 5353. Only change if you have port conflict.',
            'settings.confirmChangeDnsmasqPort': 'CRITICAL: Changing dnsmasq port to {port} will restart all VPN services. DNS may be temporarily unavailable. Current default is {default}. Are you absolutely sure?',
            'backup.title': 'Backup & Restore',
            'backup.hint': 'One file with configurations, subscriptions, the active server, VPN server users, your lists, segment policies and settings. The panel password is not included.',
            'backup.download': 'Download backup',
            'backup.downloadStarted': 'Backup download started',
            'backup.restoreLabel': 'Restore from file',
            'backup.restoreHwid': 'Also restore the router ID (HWID)',
            'backup.restoreHwidHint': 'Turn on when moving to another router, so HWID-protected subscriptions keep working. Leave off when restoring on the same router.',
            'backup.restore': 'Restore',
            'backup.warning': 'The file contains subscription links and server keys: keep it like a password. Restoring replaces all current configurations and briefly interrupts the VPN; the current state is saved on the router first.',
            'backup.chooseFile': 'Choose a backup file first',
            'backup.confirmRestore': 'Replace all configurations, subscriptions, VPN server users, lists and settings with the contents of this file? The VPN will be interrupted for a few seconds. The current state is saved on the router first.',
            'backup.restored': 'Restored: {configs} configurations, {subscriptions} subscriptions, {users} VPN server users. Reloading...',
            'backup.restoreFailed': 'Restore failed',
            'backup.empty': 'the file is empty',
            'backup.tooLarge': 'the file is too large',
            'backup.notArchive': 'not a backup archive',
            'backup.badEntry': 'the archive contains unexpected files',
            'backup.notManagerBackup': 'not a VPN Manager backup',
            'backup.badJson': 'the backup contains damaged data',
            'backup.snapshotFailed': 'could not save the current state, nothing was changed',
            'backup.internal': 'internal error',
            'backup.downloadFailed': 'Backup download failed',
            'settings.logTitle': 'Log',
            'settings.logHint': 'The log is kept in the router\'s RAM to spare the USB drive, and starts empty after a reboot. Warnings and errors are copied to the drive once a day.',
            'settings.verboseOn': 'Detailed log for 1 hour',
            'settings.verboseOff': 'Turn detailed log off',
            'settings.verboseActiveUntil': 'Detailed log is on until {time}: every connection is recorded.',
            'settings.verboseInactive': 'Normal log: warnings and errors only.',
            'settings.verboseConfirm': 'Switching the log level restarts sing-box: the VPN pauses for a few seconds. Continue?',
            'settings.verboseEnabled': 'Detailed log is on for 1 hour',
            'settings.verboseDisabled': 'Detailed log is off',
            'logs.download': 'Download',
            'logs.downloadHint': 'Download the whole log as a text file',
            'logs.downloadFailed': 'Log download failed',
            'backup.unauthorized': 'the session has expired, log in again',
            'Authorization required': 'the session has expired, log in again',
            'backup.activeMissing': 'The active server from the backup was not found in it, so no server is active now. Pick one on the VPN tab.',
            
            // Confirm
            'confirm.areYouSure': 'Are you sure?',
            
            // Logs additional
            'logs.install': 'Install',
            'logs.copyLog': 'Copy log',
            'logs.copy': 'Copy',
            'logs.selectLog': 'Select a log to view...',
            
            // Import
            'import.title': 'Import Configuration',
            'import.file': 'File (.conf)',
            'import.subscription': 'Subscription',
            'import.configUrl': 'Configuration URL',
            'import.supportedProtocols': 'Supported: Shadowsocks, VLESS, VMess, Trojan',
            'import.subscriptionUrl': 'Subscription URL',
            'import.subscriptionName': 'Subscription Name',
            'import.subscriptionNameHint': 'Optional. If not specified, it will be detected automatically.',
            'import.supportedFormats': 'Supported subscription formats',
            'import.supportedServerProtocols': 'Supported server protocols',
            'import.autoUpdate': 'Auto-update',
            'import.serversFound': 'Servers found',
            'import.configName': 'Configuration Name',
            'import.wgConfigFile': 'WireGuard configuration file',
            'import.selectOrDrag': 'Select file or drag here',
            'import.pasteContent': 'Or paste file content',
            'import.preview': 'Preview:',
            'import.validate': 'Validate',
            'import.addSubscription': 'Add subscription',
            'import.label.protocol': 'Protocol',
            'import.label.name': 'Name',
            'import.label.server': 'Server',
            'import.label.port': 'Port',
            'import.label.method': 'Method',
            'import.label.security': 'Security',
            'import.label.address': 'Address',
            
            // QR
            'qr.title': 'QR Code',
            
            // Remote lists additional
            'remoteLists.updated': 'Updated',
            
            // Recovery
            'recovery.saveCode': '⚠️ Save your recovery code!',
            'recovery.screenshot': '📱 Take a screenshot or save the code to a messenger/notes.',
            'recovery.needForPassword': 'You will need this code if you forget your password.',
            'recovery.lostWarning': '⚠️ If you lose the code and forget your password, you will need to reset Split-KVN settings via SSH.',
            'recovery.iSavedCode': 'I saved the code',
            
            // Routing tile
            'routing.refreshSegments': 'Refresh segments',
            'routing.showAllSegments': 'Show all segments',
            'routing.hideSegments': 'Hide segments',
            
            // IPv6 toggle
            'ipv6.toggle': 'Enable/disable IPv6',
            
            // VPN Server tab
            'server.attention': 'Attention',
            'server.dontAddToVpn': 'Don\'t add {method} to VPN.',
            'server.ddnsInfo': 'Links will remain working when IP changes.',
            'server.important': 'Important',
            'server.dontAddIpServices': 'Don\'t add to VPN:',
            'server.transport': 'Transport',
            'server.server': 'Server',
            'server.notDefined': 'not_defined',
            'server.passwordFormat': 'To connect, use full password in format:',
            'server.serverKeyUserKey': 'SERVER_KEY:USER_KEY',
            'server.dataNotFound': 'Data not found',
            'server.rename': 'Rename',
            'server.renameUser': 'Rename User',
            'server.newUsername': 'New Username',
            'server.confirmDeleteText': 'Are you sure you want to delete user',
            'server.regenerateKey': 'Generate new {type}',
            'server.deleteUser': 'Delete user',
            'server.password': 'Password:',
            'server.link': 'Link:',
            'server.copyPassword': 'Copy password',
            'server.copyLink': 'Copy link',
            'server.showQr': 'Show QR code',
            'server.recommendDdns': 'It\'s recommended to use DDNS link — it will remain working when IP address changes.',
            'server.disabled': 'VPN server is disabled',
            'server.noUsers': 'No users — connection not possible. Add a user to activate VPN server.',
            
            // VPN check dialog
            'vpnCheck.title': 'VPN Check',
            'vpnCheck.active': 'VPN active',
            'vpnCheck.inactive': 'VPN inactive',
            'vpnCheck.currentIp': 'Current IP',
            'vpnCheck.vpnServer': 'VPN server',
            'vpnCheck.notConfigured': 'not configured',
            'vpnCheck.status': 'Status',
            
            // Segments
            'segments.vpnClients': 'VPN clients',
            'segments.port': 'port',
            
            // Dialog buttons
            'dialog.cancel': 'Cancel',
            'dialog.ok': 'OK',
            
            // Subscription dialogs
            'subscription.editWarningTitle': 'Edit server from subscription',
            'subscription.editWarningMessage': 'This server is from a subscription. Your changes may be overwritten when subscription updates. Edit only if you know what you are doing.',
            'subscription.deleteWarningTitle': 'Delete server from subscription',
            'subscription.deleteWarningMessage': 'This server is from subscription "{name}". It may reappear on next subscription update. Delete?',
            'subscription.subscription': 'Subscription',
            'subscription.updated': 'Updated',
            'subscription.autoEvery': 'Auto: every',
            'subscription.hours': 'h',
            'subscription.days': 'd',
            'subscription.expired': 'Expired',
            'subscription.expiresIn': 'Expires in',
            'subscription.trafficUsed': 'Traffic used',
            'subscription.downloaded': 'Downloaded',
            'subscription.updateInterval': 'Recommended update interval',
            
            // Config modal
            'configModal.addTitle': 'Add VPN server',
            'configModal.saving': 'Saving...',
            
            // Messages
            'messages.vpnActivated': 'VPN activated successfully',
            'messages.intervalChanged': 'Interval changed',
            
            // IPv6
            'ipv6.on': 'IPv6: ON',
            'ipv6.off': 'IPv6: OFF',
            'ipv6.disabled': 'IPv6 disabled',
            'ipv6.enabled': 'IPv6 enabled (VPN may work unstable)',
            'ipv6.confirmDisable': 'Disable IPv6?\n\nThis is recommended for stable VPN operation.',
            'ipv6.confirmEnable': '⚠️ Enable IPv6?\n\nWARNING: With IPv6 enabled, VPN may not work properly!\nSome traffic may bypass VPN.\n\nContinue?',
            
            // Port 8388
            'port8388.open': 'Port 8388: open',
            'port8388.openBtn': 'Open port 8388',
            'port8388.confirmClose': 'Port 8388 is already open.\n\nClose port? VPN server will become inaccessible from the internet.',
            'port8388.confirmOpen': 'Open port 8388 for VPN server?\n\nThis will allow connections to router as VPN server from internet.',
            
            // Stop VPN dialog
            'stopVpn.title': 'Stop VPN?',
            'stopVpn.message': 'VPN connection will be completely stopped. All traffic will go directly without VPN.',
            
            // Import
            'import.enterUrl': 'Enter configuration URL',
            'import.pasteConfig': 'Paste configuration file content',
            'import.awgNotSupported': '⚠️ AmneziaWG is temporarily not supported due to a bug in sing-box-extended. Use regular WireGuard or other protocols.',
            'import.parseError': 'Failed to parse URL',
            'import.parsingError': 'Parsing error',
            
            // Confirm dialog
            'confirm.close': 'Close',
            
            // Subscription management
            'subscription.enterUrl': 'Enter subscription URL',
            'subscription.loading': 'Loading...',
            'subscription.noServersFound': 'No servers with supported protocols found',
            'subscription.andMore': '... and {count} more servers',
            'subscription.addedToast': 'Subscription added ({count} servers)',
            'subscription.updatedToast': 'Subscription updated ({count} servers)',
            'subscription.deleteTitle': 'Delete subscription',
            'subscription.deleteMessage': 'Delete subscription "{name}" and all its servers?',
            
            // Config delete
            'config.deleteTitle': 'Delete configuration',
            'config.deleteMessage': 'Delete configuration "{name}"?',
            
            // Domain/subnet lists
            'lists.saving': 'Saving...',
            'lists.savingAndApplying': 'Saving and applying changes...',
            'lists.savedSuccess': 'Saved successfully',
            'lists.domainsSaved': '{type} domains list saved',
            'lists.subnetsSaved': '{type} subnets list saved',
            'lists.invalidLinesSkipped': '{n} invalid line(s) will be skipped during routing',
            'lists.loadedFrom': 'Loaded from {file}',
            'lists.fileLoaded': 'File "{file}" loaded',
            'lists.fileDownloaded': 'File "{file}" downloaded',
            'lists.replaceConfirm': 'Replace current list? (Cancel — append to end)',
            'lists.empty': '(empty)',
            'lists.leadDomains': 'Here are the domain lists for the Direct primary and VPN primary modes. The mode of each network is set on the main page, in the <a href="#routing-tile" class="list-segments-link" data-goto-segments>“Segments”</a> section.',
            'lists.leadSubnets': 'Here are the subnet lists for the Direct primary and VPN primary modes. The mode of each network is set on the main page, in the <a href="#routing-tile" class="list-segments-link" data-goto-segments>“Segments”</a> section.',
            'lists.modeSplit': 'Direct primary',
            'lists.modeSplitWhat': 'these sites go through VPN',
            'lists.modeSplitWhatSubnets': 'these addresses go through VPN',
            'lists.modeVpnPrimary': 'VPN primary',
            'lists.modeVpnPrimaryWhat': 'these sites go direct',
            'lists.modeVpnPrimaryWhatSubnets': 'these addresses go direct',
            'lists.ruleSplit': 'In this mode everything goes <strong>direct</strong>, and the sites from this list go <strong class="list-mode-hl">through VPN</strong>.',
            'lists.ruleSplitSubnets': 'In this mode everything goes <strong>direct</strong>, and the addresses from this list go <strong class="list-mode-hl">through VPN</strong>.',
            'lists.ruleVpnPrimary': 'In this mode everything goes <strong>through VPN</strong>, and the sites from this list go <strong class="list-mode-hl">direct</strong>.',
            'lists.ruleVpnPrimarySubnets': 'In this mode everything goes <strong>through VPN</strong>, and the addresses from this list go <strong class="list-mode-hl">direct</strong>.',
            'lists.inModeNow': 'In this mode now',
            'lists.noSegmentsInMode': 'No network is in this mode now — the list is not used. The mode of a network is set on the main page, in the <a href="#routing-tile" class="list-segments-link" data-goto-segments>“Segments”</a> section.',
            'lists.whichList': 'Which list to use',
            'lists.otherModeHint': '{mode} uses {list}',
            'lists.bothListsHint': 'If the same site is in both lists, it always goes through VPN.',
            'lists.bothListsHintSubnets': 'If the same address is in both lists, it always goes through VPN.',
            'lists.overlapWarning': '{items} are in the other list too — VPN wins for them.',
            'lists.overlapWarningOne': '{items} is in the other list too — VPN wins for it.',
            'lists.overlapWarningSubnetOne': '{items} is in the other list too — VPN wins for it.',
            'lists.overlapMore': 'and {n} more',
            'lists.descSplitTcpUdp': 'All traffic to these sites goes through VPN.',
            'lists.descSplitTcpUdpSubnets': 'All traffic to these addresses goes through VPN.',
            'lists.descSplitUdpOnly': 'Only UDP to these sites goes through VPN, TCP goes direct.',
            'lists.descSplitUdpOnlySubnets': 'Only UDP to these addresses goes through VPN, TCP goes direct.',
            'lists.descVpnPrimaryTcpUdp': 'All traffic to these sites goes direct, bypassing VPN.',
            'lists.descVpnPrimaryTcpUdpSubnets': 'All traffic to these addresses goes direct, bypassing VPN.',
            'lists.descVpnPrimaryUdpOnly': 'Only UDP to these sites goes direct, TCP goes through VPN.',
            'lists.descVpnPrimaryUdpOnlySubnets': 'Only UDP to these addresses goes direct, TCP goes through VPN.',
            'lists.swapLists': 'Swap the lists',
            'lists.swapConfirm': 'Swap the lists? Then {toVpnPrimary} will be used for VPN primary, and {toSplit} for Direct primary.',
            'lists.unsavedSwitchConfirm': 'The lists have unsaved changes. Switch and discard them?',
            
            // Port change
            'port.changeConfirm': 'Change port to {port}?\n\nAfter change Split-KVN will be available at:\n{url}',
            'port.changed': 'Port changed to {port}. Go to address: {url}',
            
            // Autostart
            'autostart.enabled': 'Autostart enabled',
            'autostart.disabled': 'Autostart disabled',
            
            // Password validation
            'password.mismatch': 'Passwords do not match',
            'password.tooShort': 'Password must be at least 8 characters',
            'password.enterRecovery': 'Enter recovery code',
            
            // Port reserved
            'port.reserved': 'Port {port} is reserved by system',
            
            // VPN Server messages
            'server.started': 'VPN server started',
            'server.stopped': 'VPN server stopped',
            'server.restarted': 'VPN server restarted',
            'server.userAdded': 'User "{name}" added',
            'server.userDeleted': 'User "{name}" deleted',
            'server.userRenamed': 'User "{old}" renamed to "{new}"',
            'server.confirmDelete': 'Delete user "{name}"?',
            'server.enterNewName': 'New name for "{name}":',
            'server.confirmRegenerate': 'Generate new credentials for "{name}"? Old ones will stop working.',
            'server.credentialsUpdated': 'Credentials for "{name}" updated',
            'server.notConfigured': 'VPN server is not configured. Reinstall Split-KVN for automatic setup.',
            'server.lanAccess': 'Access to the panel and home network',
            'server.lanAccessLabel': 'VPN-server clients can reach',
            'server.lanAccessOff': 'No access',
            'server.lanAccessPanel': 'Panel only',
            'server.lanAccessLan': 'Panel and home network',
            'server.lanAccessHint': 'Needs a panel password. Internet traffic of VPN-server clients follows the VPN-server segment policy and does not depend on this setting.',
            'server.lanAccessSaved': 'Access for VPN-server clients saved',
            'server.lanAccessInactive': 'Off for now: the panel has no password (after a password recovery or a reinstall). Set a password and apply again.',
            'server.lanAccessPanelAddress': 'From a phone connected to the VPN server the panel opens at',
            'server.lanAccessPanelOr': 'if the name does not open:',
            'server.lanAccessDisablePasswordConfirm': 'VPN-server clients can reach the panel. Without a password the panel and the router settings are open to everyone connected to the VPN server. Turn the password off only if you trust every VPN-server user completely. Turn it off?',
            'server.userActive': 'User active',
            'server.userSuspended': 'User suspended',
            'server.suspendBtn': 'Suspend',
            'server.activateBtn': 'Activate',
            'server.userSuspendedMsg': 'User "{name}" suspended',
            'server.userResumedMsg': 'User "{name}" resumed',
            'server.unavailable': 'Unavailable',
            'server.notDetermined': 'not determined',
            'server.behindNat': 'Router behind NAT',
            'server.behindNatProbable': 'Router likely behind NAT',
            'server.externalIp': 'External IP',
            'server.externalIpUnknown': 'External IP could not be verified (check services unreachable). The router does not appear to have a directly-reachable public IP.',
            'server.natWarning': 'To connect from internet, router must have external static IP address. Contact your ISP.',
            'server.directIp': 'Direct public IP',
            'server.directIpInfo': 'Router has a publicly-reachable IP — incoming connections from the internet should work',
            
            // Logs
            'logs.loading': 'Loading...',
            'logs.fileNotExists': 'Log file does not exist',
            'logs.empty': '(log empty)',
            'logs.info': '{path} • {lines} lines • {size} KB',
            'logs.error': 'Error',
            'logs.confirmClear': 'Clear log "{name}"?',
            'logs.confirmClearAll': 'Clear ALL logs? This cannot be undone.',
            'logs.clearAll': 'Clear All',
            'logs.qrError': 'QR code generation error',
            'logs.qrLibNotLoaded': 'QR code library not loaded',
            
            // Auto-update
            'autoupdate.lastUpdate': 'Last update',
            'autoupdate.never': 'never',
            'autoupdate.enabledMsg': 'Auto-update enabled',
            'autoupdate.disabledMsg': 'Auto-update disabled',
            'autoupdate.intervalChanged': 'Interval changed: {interval}',
            'autoupdate.updateError': 'Update error',
            
            // Remote lists
            'remoteLists.updated': 'Updated',
            'remoteLists.loading': 'Loading...',
            
            // AmneziaWG
            'awg.description': 'AmneziaWG — WireGuard modification with obfuscation for DPI bypass. Parameters Jc, Jmin, Jmax, S1, S2, H1-H4 must match the server.',
            'awg.localAddress': 'Local address',
            'awg.localAddressHint': 'Client IP address in the network',
            'awg.obfuscationParams': 'Obfuscation parameters',
            'awg.minJunk': 'Min junk',
            'awg.maxJunk': 'Max junk',
            
            // Errors
            'errors.connection': 'Connection error',
            'errors.network': 'Network error',
            'errors.loading': 'Loading error',
            'errors.saving': 'Save error',
            'errors.deleting': 'Delete error',
            'errors.unknown': 'Unknown error',
            'errors.vpnStart': 'VPN start error',
            'errors.vpnStop': 'VPN stop error',
            'errors.noLastActiveConfig': 'No last active configuration found. Please activate a VPN configuration first.',
            'errors.vpnActivation': 'Activation error',
            'errors.copyFailed': 'Copy error',
            'errors.readFile': 'File read error',
            'errors.portRequired': 'Enter port number',
            'errors.portRange': 'Port must be between 1024-65535',
            'errors.portReserved': 'Port {port} is reserved by system',
            'errors.passwordMismatch': 'Passwords do not match',
            'errors.currentPasswordRequired': 'Enter current password',
            'errors.checkSubscription': 'Check subscription first',
            'errors.loadDomains': 'Failed to load domain list',
            'errors.loadSubnets': 'Failed to load subnet list',
            'errors.loadConfigs': 'Failed to load configurations',
            'errors.policyFailed': 'Failed to save policy',
            'errors.listBindingSame': 'The two modes must use different lists',
            'errors.vpnLanAccessNeedsPassword': 'Set a panel password first: without it the panel is open to every VPN-server user. You can turn the password off later, with a warning.',
            'errors.vpnLanAccessPasswordRisk': 'VPN-server clients can reach the panel: without a password it is open to all of them.',
            'errors.vpnLanAccessFailed': 'Could not save access for VPN-server clients',
            'errors.listBindingFailed': 'Failed to save the lists for the modes',
            'errors.segmentsUpdate': 'Failed to update segments',
            'errors.qrModalNotFound': 'QR code modal not found',
            'errors.serverStart': 'Start error',
            'errors.serverStop': 'Stop error',
            'errors.serverRestart': 'Restart error',
            'errors.serverAdd': 'Add error',
            'errors.serverDelete': 'Delete error',
            'errors.serverRename': 'Rename error',
            'errors.serverRegenerate': 'Regenerate error',
            'errors.invalidName': 'Name can only contain latin letters, numbers, - and _',
            'errors.portChange': 'Port change error',
            'errors.serverPortChange': 'Failed to change VPN server port',
            'errors.urlRequired': 'URL is required',
            'errors.urlInvalid': 'URL must start with http:// or https://',
            'errors.listsSourceSave': 'Failed to save lists source URL',
            'errors.listsSourceReset': 'Failed to reset lists source URL',
            'errors.dnsmasqPortChange': 'Failed to change dnsmasq port',
            'errors.withMessage': 'Error: {message}',
            'errors.subscriptionSave': 'Subscription save error',
            'errors.subscriptionUpdate': 'Subscription update error',
            'errors.domainExists': 'Domain already exists in list',
            'errors.settingsSave': 'Settings save error',
            'errors.subscriptionIdRequired': 'Subscription ID is required',
            'errors.emptyListServersKept': 'New list is empty. Current servers kept.',
            'errors.noSupportedServers': 'No servers with supported protocols found',
            'errors.singboxStartFailed': 'sing-box failed to start',
            'errors.singboxNotInstalled': 'sing-box is not installed',
            'errors.vpnServerNotConfigured': 'VPN server is not configured',
            'errors.usernameRequired': 'Username is required',
            'errors.subscriptionLoadFailed': 'Failed to load subscription. Current servers kept.',
            'errors.invalidValue': 'Invalid value',
            'errors.invalidInterval': 'Invalid interval. Allowed: 6, 12, 24',
            'errors.cannotDeleteActiveSubscription': 'Cannot delete subscription while its server is active. Stop VPN first.',
            'errors.validationErrors': 'Validation errors',
            'errors.enabledRequired': 'Parameter enabled is required',
            'errors.intervalRequired': 'Parameter interval is required',
            'errors.paramQRequired': 'Parameter q is required',
            'errors.updateScriptNotFound': 'Update script not found',
            'errors.oldNewNameRequired': 'Old and new username are required',
            'errors.specifyUsername': 'Specify username',
            'errors.fileNotFound': 'File not found',
            
            // Success messages
            'success.copied': 'Copied',
            'success.codeCopied': 'Code copied',
            'success.passwordSet': 'Password set',
            'success.saved': 'Saved',
            'success.deleted': 'Deleted',
            'success.updated': 'Updated',
            'success.passwordChanged': 'Password changed successfully',
            'success.authDisabled': 'Authorization disabled',
            'success.authModeChanged': 'Authorization mode changed',
            'success.serverDeleted': 'Server deleted',
            'success.configUpdated': 'Configuration updated',
            'success.configAdded': 'Configuration added',
            'success.configDeleted': 'Configuration deleted',
            'success.configParsed': 'Configuration parsed successfully',
            'success.configImported': 'Configuration imported',
            'success.subscriptionDeleted': 'Subscription deleted',
            'success.fileDownloaded': 'File downloaded',
            'success.rulesUpdated': 'dnsmasq/iptables rules updated',
            'success.iptablesUpdated': 'iptables rules updated',
            'success.portChanged': 'Port changed',
            'success.serverPortChanged': 'VPN server port changed successfully',
            'success.updateSourceSaved': 'Update source saved',
            'success.updateStarted': 'Update started',
            'success.updateDone': 'Updated to {version}',
            'success.updateChecked': 'Checked',
            'success.autoUpdateOn': 'Automatic updates enabled',
            'success.autoUpdateOff': 'Automatic updates disabled',
            'success.listsSourceSaved': 'Remote lists source URL saved',
            'success.listsSourceReset': 'Remote lists source URL reset to default',
            'success.dnsmasqPortChanged': 'dnsmasq port changed. Services restarting...',
            'success.accessRestored': 'Access restored! Login with admin/admin.',
            'success.copiedToClipboard': 'Copied to clipboard',
            'success.policyUpdated': 'Policy updated',
            'success.listBindingSaved': 'Lists for the modes saved',
            'success.segmentsUpdated': 'Segments updated',
            'success.logCleared': 'Log cleared',
            'success.allLogsCleared': 'All logs cleared',
            'success.listsUpdated': 'Lists updated ({domains} domains, {subnets} subnets)',
            'success.listsUpdatedShort': 'Lists updated',
            'success.portClosed': 'Port 8388 closed',
            'success.portOpened': 'Port 8388 opened',
            'success.vpnStopped': 'VPN stopped',
            
            // Info/warning messages
            'info.pleaseWait': 'Please wait, operation in progress...',
            'info.startingVpn': 'Starting VPN...',
            'info.checkingConfig': 'Checking configuration...',
            'info.checkingIp': 'Checking IP...',
            'info.disablingIpv6': 'Disabling IPv6...',
            'info.enablingIpv6': 'Enabling IPv6...',
            'info.closingPort': 'Closing port 8388...',
            'info.openingPort': 'Opening port 8388...',
            'info.stoppingVpn': 'Stopping VPN...',
            'info.updatingSubscription': 'Updating subscription...',
            'warning.listEmpty': 'List is empty',
            'warning.logEmpty': 'Log is empty',

            // Donate
            'donate.button': 'Donate',
            'donate.title': '{donut_icon} Support the project',
            'donate.message': 'Split-KVN was built with passion through sleepless nights. If it\u2019s been useful to you, then the effort was worth it.<br><br>The developer will be grateful for any reward in {usdt_icon} USDT (TRC-20).<br><br>It\u2019s not required, but it would mean a lot =)',
            'donate.copyAddress': 'Copy address',
            'donate.copied': 'Address copied!',
            'donate.thankYou': 'Thank you for your support!',
            'donate.close': 'OK'
        },
        
        ru: {
            // Header
            'app.title': 'Split-KVN',
            'header.autostart': 'Автозапуск',
            'header.language': 'Язык',
            'header.vpnActive': 'VPN активен',
            'header.vpnStopped': 'VPN остановлен',
            'deviceId.copied': 'Device ID скопирован',
            'time.h': 'ч',
            'time.min': 'мин',
            'time.s': 'с',
            'time.d': 'д',
            'time.ago': 'назад',
            
            // Tabs
            'tab.vpn': 'VPN-конфигурации',
            'tab.domains': 'Домены',
            'tab.subnets': 'IP-подсети',
            'tab.server': 'VPN-сервер',
            
            // Subtabs
            'subtab.tcpudp': 'TCP + UDP',
            'subtab.udponly': 'Только UDP',
            
            // VPN Tab
            'vpn.title': 'VPN-конфигурации',
            'vpn.status.running': 'Работает',
            'vpn.status.stopped': 'Остановлен',
            'vpn.status.notConfigured': 'Не настроено',
            'vpn.addConfig': 'Добавить конфигурацию',
            'vpn.addSubscription': 'Добавить подписку',
            'vpn.noConfigs': 'Нет VPN-конфигураций',
            'vpn.addFirst': 'Добавьте первую VPN-конфигурацию для начала работы',
            'vpn.activate': 'Активировать',
            'vpn.deactivate': 'Деактивировать',
            'vpn.edit': 'Редактировать',
            'vpn.delete': 'Удалить',
            'vpn.active': 'Активна',
            'vpn.routingPolicy': 'Политика маршрутизации',
            'vpn.stop': 'Остановить',
            'vpn.start': 'Запустить',
            'vpn.start.title': 'Запустить VPN с последней активной конфигурацией',
            'vpn.stop.title': 'Остановить VPN полностью',
            'vpn.checkIp': 'Проверить IP',
            'vpn.checkIp.title': 'Проверить текущий IP-адрес',
            'vpn.import': 'Импорт',
            'vpn.import.title': 'Импорт из URL',
            'vpn.export': 'Экспорт',
            'vpn.export.title': 'Экспорт подписок и конфигураций',
            'exportConfigs.title': 'Экспорт конфигураций',
            'exportConfigs.description': 'Выберите, что выгрузить. Подписка выгружается своей ссылкой — серверы внутри неё восстановятся из неё же, поэтому отдельно они не показаны.',
            'exportConfigs.selectAll': 'Выбрать все',
            'exportConfigs.subscriptions': 'Подписки',
            'exportConfigs.kindSubscription': 'подписка',
            'exportConfigs.standalone': 'Отдельные конфигурации',
            'exportConfigs.servers': 'серверов: {n}',
            'exportConfigs.asFile': 'файл',
            'exportConfigs.build': 'Выгрузить',
            'exportConfigs.back': 'Назад',
            'exportConfigs.copyAll': 'Скопировать всё',
            'exportConfigs.linksLabel': 'Ссылки',
            'exportConfigs.filesLabel': 'Доступны файлами',
            'exportConfigs.filesHint': 'У этих протоколов нет ссылочной формы, поэтому они выгружаются файлами .conf.',
            'exportConfigs.download': 'Скачать',
            'exportConfigs.copied': 'Скопировано в буфер обмена',
            'exportConfigs.copyFailed': 'Не удалось скопировать — выделите текст и скопируйте вручную',
            'exportConfigs.selectAtLeastOne': 'Отметьте хотя бы один пункт',
            'exportConfigs.nothing': 'Экспортировать нечего',
            'exportConfigs.noLinks': 'У выбранного нет ссылочной формы — смотрите файлы ниже.',
            'vpn.add': 'Добавить',
            'vpn.servers': 'VPN-серверы',
            'vpn.activeConfig': 'Активная конфигурация',
            'vpn.uptime': 'Время работы',
            'vpn.server': 'Сервер',
            'vpn.configsCount': 'Конфигураций',
            'vpn.domainsCount': 'Доменов',
            'vpn.upload': 'ОТПРАВЛЕНО',
            'vpn.download': 'ПОЛУЧЕНО',
            'vpn.connections': 'СОЕДИНЕНИЯ',
            'vpn.autostart': 'Автостарт при загрузке',
            
            // Routing policies
            'routing.direct': 'Весь трафик напрямую, VPN не используется',
            'routing.split': 'Всё напрямую, набор-список через VPN',
            'routing.vpnprimary': 'Всё через VPN, набор-список напрямую',
            'routing.fullvpn': 'Полный VPN (весь трафик)',
            'routing.disabled': 'VPN отключён для этого сегмента',
            'routing.policyLabel': 'Режим маршрутизации',
            'routing.policy.direct': 'Direct',
            'routing.policy.split': 'Direct primary',
            'routing.policy.vpnprimary': 'VPN primary',
            'routing.policy.fullvpn': 'Full VPN',
            'routing.policy.fullvpnShort': 'VPN',
            
            // Segments
            'segments.title': 'Сегменты сети',
            'segments.refresh': 'Обновить',
            'segments.name': 'Сегмент',
            'segments.network': 'Сеть',
            'segments.policy': 'Политика',
            'segments.devices': 'устройств',
            
            // Domains
            'domains.title': 'Маршрутизация по доменам',
            'domains.description': 'Домены, направляемые через VPN',
            'domains.tcpudp.title': 'TCP+UDP домены',
            'domains.udponly.title': 'UDP-only домены',
            'domains.placeholder': 'Введите домены, по одному на строку',
            'domains.save': 'Сохранить',
            'domains.saved': 'Список доменов сохранён',
            'domains.hint': 'Вводите доменные имена без http://, по одному на строку. Пример: youtube.com',
            
            // Subnets
            'subnets.title': 'Маршрутизация по IP-подсетям',
            'subnets.description': 'IP-подсети, направляемые через VPN',
            'subnets.tcpudp.title': 'TCP+UDP подсети',
            'subnets.udponly.title': 'UDP-only подсети',
            'subnets.placeholder': 'Введите подсети в формате CIDR, по одной на строку',
            'subnets.save': 'Сохранить',
            'subnets.saved': 'Список подсетей сохранён',
            'subnets.hint': 'Вводите подсети в формате CIDR. Пример: 8.8.8.0/24',
            
            // Auto-update lists
            'autoupdate.title': 'Автообновление списков',
            'autoupdate.checkbox': 'Автоматическое дополнение набора доменов и подсетей',
            'autoupdate.source': 'Источник',
            'autoupdate.interval': 'Интервал обновления',
            'autoupdate.lastUpdate': 'Последнее обновление',
            'autoupdate.never': 'Никогда',
            'autoupdate.updateNow': 'Обновить сейчас',
            'autoupdate.hours3': 'Каждые 3 часа',
            'autoupdate.hours6': 'Каждые 6 часов',
            'autoupdate.hours12': 'Каждые 12 часов',
            'autoupdate.hours24': 'Каждые 24 часа',
            'autoupdate.schedule3': 'Расписание: 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00',
            'autoupdate.schedule6': 'Расписание: 00:00, 06:00, 12:00, 18:00',
            'autoupdate.schedule12': 'Расписание: 00:00, 12:00',
            'autoupdate.schedule24': 'Расписание: 04:00 (раз в день)',
            'autoupdate.enabled': 'Автообновление включено',
            'autoupdate.disabled': 'Автообновление отключено',
            'autoupdate.updating': 'Обновление...',
            'autoupdate.success': 'Списки успешно обновлены',
            'autoupdate.viewFiles': 'Просмотреть скачанные списки',
            'autoupdate.transferToLocal': 'Перенести в локальные списки',
            'autoupdate.transferToLocalTitle': 'Скопировать текущие скачанные удалённые списки в локальные и отключить автообновление',
            
            // Server export/import users
            'server.export': 'Экспорт',
            'server.exportTitle': 'Экспорт пользователей VPN-сервера в JSON-файл',
            'server.import': 'Импорт',
            'server.importTitle': 'Импорт пользователей VPN-сервера из JSON-файла',
            'exportUsers.title': 'Экспорт пользователей VPN-сервера',
            'exportUsers.description': 'Выберите пользователей для экспорта. JSON-файл содержит имена и UUID. Его можно загрузить позже (например, после переустановки VPN Manager), чтобы клиенты продолжили работать без изменения их конфигов.',
            'exportUsers.selectAll': 'Выбрать всех',
            'exportUsers.download': 'Скачать',
            'exportUsers.downloadStarted': 'Скачивание начато',
            'exportUsers.selectAtLeastOne': 'Выберите хотя бы одного пользователя',
            'exportUsers.noUsers': 'Нет пользователей для экспорта',
            'importUsers.title': 'Импорт пользователей VPN-сервера',
            'importUsers.description': 'Загрузите JSON-файл, ранее созданный экспортом. При совпадении имён используется правило ниже.',
            'importUsers.fileLabel': 'JSON-файл с пользователями',
            'importUsers.modeLabel': 'Если пользователь с таким именем уже существует:',
            'importUsers.modeSkip': 'Пропустить (оставить существующего)',
            'importUsers.modeOverwrite': 'Перезаписать UUID',
            'importUsers.import': 'Импортировать',
            'importUsers.previewTitle': 'В файле {n} пользователь(ей):',
            'importUsers.invalidFile': 'Это не файл экспорта VPN Manager',
            'importUsers.pickFile': 'Сначала выберите файл',
            'importUsers.summary': 'Добавлено: {added}, перезаписано: {overwritten}, пропущено: {skipped}, невалидных: {invalid}',
            
            // IPSet viewer
            'ipset.viewBtn': 'IPSet',
            'ipset.viewTitle': 'Просмотр ipset ядра и ручной прогрев доменов',
            'ipset.title': 'Содержимое IPSet',
            'ipset.groupDomains': 'Домены (заполняет dnsmasq)',
            'ipset.groupSubnets': 'Подсети (из ваших списков подсетей)',
            'ipset.description': 'Текущий снимок ipset уровня ядра, по которым идёт маршрутизация VPN. Доменные ipset заполняет dnsmasq при разрешении DNS-запросов; подсетные — загружаются из ваших списков подсетей.',
            'ipset.warmupBtn': 'Прогреть домены',
            'ipset.warmupStarting': 'Запуск прогрева…',
            'ipset.warmupRunning': 'Идёт прогрев…',
            'ipset.warmupFinished': 'Прогрев завершён',
            'ipset.warmupStarted': 'Прогрев запущен в фоне',
            'ipset.notLoaded': '(ipset не создан)',
            'ipset.truncated': 'обрезано, показаны первые {n} записей',
            'ipset.downloadBtn': 'Скачать снимок',
            'ipset.downloadTitle': 'Скачать полный текстовый снимок всех ipset (без обрезки)',
            'ipset.downloadStarted': 'Скачивание снимка начато',
            
            // Transfer remote → local modal
            'transferToLocal.title': 'Перенести удалённые списки в локальные',
            'transferToLocal.description': 'Скопировать текущие скачанные удалённые списки обоих наборов (ruunblockdomains и ruservices) в ваши локальные. После переноса автообновление будет отключено — локальные списки станут единственным источником.',
            'transferToLocal.scopeLabel': 'Что переносим',
            'transferToLocal.scopeAll': 'все списки (домены и подсети, TCP+UDP и UDP-only)',
            'transferToLocal.scopeDomains': 'домены (TCP+UDP и UDP-only)',
            'transferToLocal.scopeSubnets': 'подсети (TCP+UDP и UDP-only)',
            'transferToLocal.modeReplace': 'Заменить локальные списки удалёнными',
            'transferToLocal.modeAppend': 'Добавить удалённые к существующим локальным',
            'transferToLocal.warning': 'Резервная копия предыдущего локального файла сохраняется в /opt/etc/vpn-manager/backups (хранится последние 5).',
            'transferToLocal.confirm': 'Перенести',
            'transferToLocal.success': 'Перенесено записей: {n} из {f} файлов; автообновление отключено',
            
            // Failover (auto-switch VPN configs)
            'failover.label': 'Автоматически менять сервер при сбое',
            'failover.modeOff': 'Выкл',
            'failover.modeSubscription': 'Внутри текущей подписки',
            'failover.modeAll': 'По всем конфигурациям',
            'failover.interval': 'Интервал проверки',
            'failover.lastCheck': 'Последняя проверка',
            'failover.checkNow': 'Проверить сейчас',
            'failover.checkNowTitle': 'Запустить проверку немедленно',
            'failover.recentSwitches': 'Недавние переключения',
            'failover.statusOk': 'OK',
            'failover.statusFailed': 'СБОЙ',
            'failover.noActive': 'нет активной конфигурации',
            'failover.toastOk': 'VPN-туннель работает',
            'failover.toastFailed': 'VPN-туннель недоступен',
            'failover.toastNoActive': 'Нет активной VPN-конфигурации для проверки',
            'failover.toastDone': 'Проверка выполнена',
            'failover.toastError': 'Не удалось выполнить проверку: ',
            'failover.checking': 'Проверка…',
            
            // Multi-connection mode (several servers at once, multi.cgi)
            'multi.modeSingle': 'Одно подключение',
            'multi.modeSingleWhat': 'один сервер за раз',
            'multi.modeMulti': 'Несколько подключений',
            'multi.modeMultiWhat': 'несколько серверов, замена при сбое',
            'multi.switchedMulti': 'Включён режим нескольких подключений',
            'multi.switchedSingle': 'Включён режим одного подключения',
            'multi.tileTitle': 'Несколько подключений',
            'multi.counter': '{n} из {limit}',
            'multi.counterTitle': 'Выбрано серверов / лимит',
            'multi.checkNow': 'Проверить сейчас',
            'multi.checkNowTitle': 'Проверить все серверы сейчас (до 15 с)',
            'multi.checking': 'Проверка…',
            'multi.lastCheck': 'Последняя проверка',
            'multi.never': 'ещё не было',
            'multi.empty': 'Серверы не выбраны. Отметьте их в списке ниже.',
            'multi.statusMain': 'Главный',
            'multi.statusReserve': 'Запасной',
            'multi.statusDown': 'Не отвечает',
            'multi.statusUnknown': 'Не проверен',
            'multi.carrying': 'Трафик',
            'multi.carryingTitle': 'Сейчас трафик идёт через этот сервер',
            'multi.makePrimary': 'Сделать главным',
            'multi.isPrimary': 'Главный сервер',
            'multi.remove': 'Убрать из выбора',
            'multi.undoRemove': 'Оставить сервер',
            'multi.pendingAdd': 'будет добавлен',
            'multi.pendingRemove': 'будет убран',
            'multi.ms': 'мс',
            'multi.truncated': 'Не вошли в лимит {limit}: {n} — эти серверы из отмеченных подписок не используются',
            'multi.subFit': 'вошло {fit} из {n}',
            'multi.subFitTitle': 'В лимит {limit} серверов вошла только часть подписки',
            'multi.countryHint': 'Лучше выбирать серверы одной страны: при переключении сайты видят то же местоположение.',
            'multi.selectSub': 'Отметить все серверы подписки',
            'multi.selectServer': 'Использовать этот сервер',
            'multi.selectedCount': 'выбрано: {n}',
            'multi.wgDisabled': 'WireGuard и AmneziaWG нельзя совмещать с другими серверами. Используйте их в режиме одного подключения.',
            'multi.wgShort': 'только для одного подключения',
            'multi.limitReached': 'Достигнут лимит: не больше {limit} серверов',
            'multi.subTooBig': 'В подписке «{name}» серверов: {n}. Поместится ещё {free} (лимит {limit}). Отметьте нужные серверы по одному.',
            'multi.pending': 'Выбрано {n} из {limit} · ещё не применено',
            'multi.pendingEmpty': 'Ничего не выбрано · отметьте хотя бы один сервер',
            'multi.applyNote': 'VPN перезапустится: 2–3 с без связи',
            'multi.apply': 'Применить',
            'multi.applying': 'Применяю…',
            'multi.reset': 'Отменить',
            'multi.applied': 'Выбор применён',
            'multi.primarySet': 'Главный сервер изменён',
            'multi.checkDone': 'Проверка выполнена',
            'multi.loadError': 'Не удалось загрузить состояние режима нескольких подключений: ',
            'multi.errors.limit': 'Выбрано слишком много серверов: лимит превышен',
            'multi.errors.empty': 'Выберите хотя бы один сервер',
            'multi.errors.wireguard': 'WireGuard и AmneziaWG нельзя использовать в режиме нескольких подключений',
            'multi.errors.notFound': 'Одного из выбранных серверов уже нет. Обновите страницу.',
            'multi.errors.apply': 'Не удалось собрать конфигурацию для выбранных серверов',
            'multi.errors.start': 'Конфигурация применена, но VPN не запустился',
            
            // Remote lists modal
            'remoteLists.title': 'Скачанные списки доменов и подсетей',
            'remoteLists.tcpudpDomains': 'TCP+UDP домены',
            'remoteLists.udpDomains': 'UDP домены',
            'remoteLists.tcpudpSubnets': 'TCP+UDP подсети',
            'remoteLists.udpSubnets': 'UDP подсети',
            
            // VPN Server
            'server.title': 'VPN-сервер',
            'server.status': 'Статус',
            'server.running': 'Работает',
            'server.stopped': 'Остановлен',
            'server.start': 'Запустить',
            'server.stop': 'Остановить',
            'server.restart': 'Перезапустить',
            'server.port': 'Порт',
            'server.method': 'Метод',
            'server.serverKey': 'Серверный ключ',
            'server.protocol': 'Протокол',
            'server.users': 'Пользователи',
            'server.addUser': 'Добавить пользователя',
            'server.noUsers': 'Нет настроенных пользователей',
            'server.username': 'Имя пользователя',
            'server.password': 'Пароль',
            'server.showQR': 'Показать QR',
            'server.copyLink': 'Скопировать ссылку',
            'server.deleteUser': 'Удалить пользователя',
            
            // IPv6
            'ipv6.title': 'Настройки IPv6',
            'ipv6.enabled': 'IPv6 включён',
            'ipv6.disabled': 'IPv6 отключён',
            'ipv6.enable': 'Включить IPv6',
            'ipv6.disable': 'Отключить IPv6',
            'ipv6.pending': 'Ожидание...',
            
            // Modals
            'modal.close': 'Закрыть',
            'modal.save': 'Сохранить',
            'modal.cancel': 'Отмена',
            'modal.confirm': 'Подтвердить',
            'modal.delete': 'Удалить',
            
            // Config modal
            'configModal.titleAdd': 'Добавить VPN-конфигурацию',
            'configModal.titleEdit': 'Редактировать VPN-конфигурацию',
            'configModal.name': 'Название',
            'configModal.namePlaceholder': 'Мой VPN сервер',
            'configModal.server': 'Адрес сервера',
            'configModal.serverPlaceholder': 'example.com или 1.2.3.4',
            'configModal.port': 'Порт',
            'configModal.protocol': 'Протокол',
            'configModal.importLink': 'Или вставьте ссылку',
            'configModal.importPlaceholder': 'ss://, vless://, vmess://, trojan://, wg://',
            'configModal.required': '*',
            
            // Config modal - IPv6
            'configModal.ipv6Enable': 'Включить IPv6',
            'configModal.ipv6Hint': 'Включает IPv6 на роутере при активации этой конфигурации. По умолчанию выключено — не все VPN-серверы поддерживают IPv6.',
            'configModal.ipv6Warning': '⚠️ Изменение применится в течение 1 минуты после сохранения',
            
            // Config modal - Shadowsocks
            'configModal.password': 'Пароль',
            'configModal.passwordPlaceholder': 'Пароль Shadowsocks',
            'configModal.encryptionMethod': 'Метод шифрования',
            'configModal.udpOverTcp': 'UDP over TCP',
            'configModal.udpOverTcpHint': 'Включите, если сервер не поддерживает нативный UDP. Отключите для лучшей работы VoIP (WhatsApp звонки на ПК).',
            'configModal.showPassword': 'Показать пароль',
            
            // Config modal - VLESS
            'configModal.vlessInfo': 'sing-box Extended: Поддерживаются транспорты TCP, WebSocket, gRPC, XHTTP.',
            'configModal.flow': 'Flow',
            'configModal.flowNone': 'Нет',
            'configModal.flowVision': 'xtls-rprx-vision (рекомендуется)',
            'configModal.security': 'Безопасность',
            
            // Config modal - VMess
            'configModal.encryption': 'Шифрование',
            
            // Config modal - Trojan
            'configModal.trojanPasswordPlaceholder': 'Пароль Trojan',
            'configModal.skipCertVerify': 'Пропустить проверку сертификата',
            
            // Config modal - WireGuard
            'configModal.privateKey': 'Private Key',
            'configModal.peerPublicKey': 'Peer Public Key',
            'configModal.localAddress': 'Локальный адрес',
            'configModal.localAddressHint': 'IP-адрес клиента в сети WireGuard',
            'configModal.presharedKey': 'Pre-shared Key',
            'configModal.optional': 'Опционально',
            'configModal.showKey': 'Показать ключ',
            
            // Subscription modal
            'subModal.titleAdd': 'Добавить подписку',
            'subModal.titleEdit': 'Редактировать подписку',
            'subModal.name': 'Название подписки',
            'subModal.url': 'URL подписки',
            'subModal.update': 'Обновить подписку',
            
            // Logs
            'logs.title': 'Логи',
            'logs.singbox': 'sing-box',
            'logs.boot': 'Загрузка',
            'logs.autoinstall': 'Авто-установка',
            'logs.installer': 'Установщик',
            'logs.vpnmanager': 'Split-KVN',
            'logs.refresh': 'Обновить',
            'logs.download': 'Скачать',
            'logs.clear': 'Очистить',
            'logs.clearAll': 'Очистить все',
            'logs.confirmClearAll': 'Очистить ВСЕ логи? Это действие нельзя отменить.',
            
            // Auth
            'auth.title': 'Авторизация',
            'auth.password': 'Пароль',
            'auth.login': 'Войти',
            'auth.logout': 'Выйти',
            'auth.changePassword': 'Изменить пароль',
            'auth.newPassword': 'Новый пароль',
            'auth.confirmPassword': 'Подтвердите пароль',
            'auth.setPassword': 'Установить пароль',
            'auth.wrongPassword': 'Неверный пароль',
            'auth.passwordChanged': 'Пароль успешно изменён',
            'auth.firstLogin': 'Первый вход. Пожалуйста, установите пароль.',
            
            // Common / Actions
            'actions.copy': 'Копировать',
            'common.settings': 'Настройки',
            'vpn.status': 'Статус VPN',
            'common.loading': 'Загрузка...',
            'common.error': 'Ошибка',
            'common.success': 'Успешно',
            'common.warning': 'Предупреждение',
            'common.info': 'Информация',
            'common.yes': 'Да',
            'common.no': 'Нет',
            'common.on': 'Вкл',
            'common.off': 'Выкл',
            'common.enabled': 'Включено',
            'common.disabled': 'Отключено',
            'common.apply': 'Применить',
            'common.reset': 'Сбросить',
            'common.refresh': 'Обновить',
            'common.actions': 'Действия',
            'time.h': 'ч',
            'time.min': 'мин',
            'lists.invalidLinesSkipped': 'Пропущено невалидных строк: {n}',
            'lists.leadDomains': 'Здесь — списки доменов для режимов Direct primary и VPN primary. Сам режим для каждой сети задаётся на главной странице, в разделе <a href="#routing-tile" class="list-segments-link" data-goto-segments>«Сегменты»</a>.',
            'lists.leadSubnets': 'Здесь — списки подсетей для режимов Direct primary и VPN primary. Сам режим для каждой сети задаётся на главной странице, в разделе <a href="#routing-tile" class="list-segments-link" data-goto-segments>«Сегменты»</a>.',
            'lists.modeSplit': 'Direct primary',
            'lists.modeSplitWhat': 'эти сайты — через VPN',
            'lists.modeSplitWhatSubnets': 'эти адреса — через VPN',
            'lists.modeVpnPrimary': 'VPN primary',
            'lists.modeVpnPrimaryWhat': 'эти сайты — напрямую',
            'lists.modeVpnPrimaryWhatSubnets': 'эти адреса — напрямую',
            'lists.ruleSplit': 'В этом режиме всё идёт <strong>напрямую</strong>, а сайты из этого списка — <strong class="list-mode-hl">через VPN</strong>.',
            'lists.ruleSplitSubnets': 'В этом режиме всё идёт <strong>напрямую</strong>, а адреса из этого списка — <strong class="list-mode-hl">через VPN</strong>.',
            'lists.ruleVpnPrimary': 'В этом режиме всё идёт <strong>через VPN</strong>, а сайты из этого списка — <strong class="list-mode-hl">напрямую</strong>.',
            'lists.ruleVpnPrimarySubnets': 'В этом режиме всё идёт <strong>через VPN</strong>, а адреса из этого списка — <strong class="list-mode-hl">напрямую</strong>.',
            'lists.inModeNow': 'Сейчас в этом режиме',
            'lists.noSegmentsInMode': 'Ни одна сеть сейчас не в этом режиме — список не используется. Режим сети задаётся на главной странице, в разделе <a href="#routing-tile" class="list-segments-link" data-goto-segments>«Сегменты»</a>.',
            'lists.whichList': 'Какой список брать',
            'lists.otherModeHint': 'У {mode} — {list}',
            'lists.bothListsHint': 'Если один и тот же сайт записан в обоих списках, он всегда идёт через VPN.',
            'lists.bothListsHintSubnets': 'Если один и тот же адрес записан в обоих списках, он всегда идёт через VPN.',
            'lists.overlapWarning': '{items} есть и в другом списке — для них главнее VPN.',
            'lists.overlapWarningOne': '{items} есть и в другом списке — для него главнее VPN.',
            'lists.overlapWarningSubnetOne': '{items} есть и в другом списке — для неё главнее VPN.',
            'lists.overlapMore': 'и ещё {n}',
            'lists.descSplitTcpUdp': 'Весь трафик к этим сайтам идёт через VPN.',
            'lists.descSplitTcpUdpSubnets': 'Весь трафик к этим адресам идёт через VPN.',
            'lists.descSplitUdpOnly': 'Через VPN идёт только UDP к этим сайтам, TCP — напрямую.',
            'lists.descSplitUdpOnlySubnets': 'Через VPN идёт только UDP к этим адресам, TCP — напрямую.',
            'lists.descVpnPrimaryTcpUdp': 'Весь трафик к этим сайтам идёт напрямую, мимо VPN.',
            'lists.descVpnPrimaryTcpUdpSubnets': 'Весь трафик к этим адресам идёт напрямую, мимо VPN.',
            'lists.descVpnPrimaryUdpOnly': 'Напрямую идёт только UDP к этим сайтам, TCP — через VPN.',
            'lists.descVpnPrimaryUdpOnlySubnets': 'Напрямую идёт только UDP к этим адресам, TCP — через VPN.',
            'lists.swapLists': 'Поменять списки местами',
            'lists.swapConfirm': 'Поменять списки местами? Тогда {toVpnPrimary} будет для VPN primary, а {toSplit} — для Direct primary.',
            'lists.unsavedSwitchConfirm': 'В списках есть несохранённые изменения. Переключить и отбросить их?',
            
            // Errors
            'error.network': 'Ошибка сети',
            'error.server': 'Ошибка сервера',
            'error.auth': 'Требуется авторизация',
            'error.unknown': 'Неизвестная ошибка',
            
            // Auth additional
            'auth.username': 'Логин',
            'auth.forgotPassword': 'Забыли пароль?',
            'auth.recoveryTitle': 'Восстановление доступа',
            'auth.recoverySubtitle': 'Введите код восстановления',
            'auth.recoveryCode': 'Код восстановления',
            'auth.recoveryHint': 'Код, который вы сохранили при установке пароля',
            'auth.recover': 'Восстановить доступ',
            'auth.backToLogin': '← Вернуться к входу',
            'auth.changePasswordTitle': 'Смена пароля',
            'auth.changePasswordSubtitle': 'Требуется при первом входе',
            'auth.passwordMinLength': 'Минимум 8 символов',
            'auth.setupTitle': 'Настройка доступа',
            'auth.setupSubtitle': 'Выберите режим авторизации',
            'auth.localOnlyInfo': 'Split-KVN доступен только из локальной сети роутера. Доступ из интернета невозможен.',
            'auth.noPassword': 'Без пароля',
            'auth.noPasswordDesc': 'Быстрый доступ без авторизации',
            'auth.setPasswordDesc': 'Защита от несанкционированного доступа',
            
            // Onboarding
            'onboarding.tip': '💡 Совет',
            'onboarding.setPasswordHint': 'Здесь можно установить пароль для защиты Split-KVN',
            'onboarding.gotIt': 'Понятно',
            
            // VPN additional
            'vpn.loadingConfigs': 'Загрузка конфигураций...',
            'vpn.autostartTooltip': 'Автоматически запускать VPN при загрузке роутера',
            
            // Domains additional
            'domains.editorHint': 'Один домен на строку. Поддомены включаются автоматически.',
            'domains.udponly.hint': 'Один домен на строку. TCP-трафик к этим доменам НЕ пойдёт через VPN.',
            'domains.tcpudp.placeholder': '# TCP+UDP домены — весь трафик через VPN\n# Один домен на строку:\nyoutube.com\nnetflix.com\nopenai.com',
            'domains.udponly.placeholder': '# UDP-only домены — только UDP через VPN\n# TCP к этим доменам идёт напрямую\ndiscord.com\ntwitch.tv\nzoom.us',
            
            // Subnets additional
            'subnets.editorHint': 'Формат: CIDR (например, 157.240.0.0/16). Один адрес на строку.',
            'subnets.udponly.hint': 'Формат: CIDR. TCP-трафик к этим подсетям НЕ пойдёт через VPN.',
            'subnets.tcpudp.placeholder': '# IP-подсети для TCP+UDP маршрутизации\n# Формат CIDR:\n157.240.0.0/16\n31.13.0.0/16',
            'subnets.udponly.placeholder': '# IP-подсети для UDP-only маршрутизации\n# TCP к этим адресам идёт напрямую\n# Пример для Telegram:\n# 91.108.4.0/22',
            
            // Common additional
            'common.upload': 'Загрузить',
            'common.download': 'Скачать',
            'common.uploadFile': 'Загрузить из файла',
            'common.downloadFile': 'Скачать в файл',
            
            // Server additional
            'server.description': 'VPN-сервер позволяет подключаться к роутеру извне. Трафик клиентов маршрутизируется по тем же правилам, что и локальных устройств. Для подключения из интернета необходимо открыть порт 8388. Для расширенного управления переадресацией портов используйте веб-интерфейс роутера.',
            'server.credentials': 'Данные для подключения',
            'server.usernameHint': 'Латинские буквы, цифры, - и _',
            'server.attention': 'Внимание',
            'server.dontAddToVpn': 'Не добавляйте {method} в VPN.',
            'server.ddnsInfo': 'Ссылки продолжат работать при смене IP.',
            'server.important': 'Важно',
            'server.dontAddIpServices': 'Не добавляйте в VPN:',
            'server.transport': 'Транспорт',
            'server.server': 'Сервер',
            'server.notDefined': 'не определён',
            'server.passwordFormat': 'Для подключения используйте полный пароль в формате:',
            'server.serverKeyUserKey': 'СЕРВЕРНЫЙ_КЛЮЧ:КЛЮЧ_ПОЛЬЗОВАТЕЛЯ',
            'server.dataNotFound': 'Данные не найдены',
            'server.rename': 'Переименовать',
            'server.renameUser': 'Переименовать пользователя',
            'server.newUsername': 'Новое имя',
            'server.confirmDeleteText': 'Вы уверены, что хотите удалить пользователя',
            'server.regenerateKey': 'Сгенерировать новый {type}',
            'server.link': 'Ссылка:',
            'server.copyPassword': 'Скопировать пароль',
            'server.showQr': 'Показать QR-код',
            'server.recommendDdns': 'Рекомендуется использовать DDNS-ссылку — она продолжит работать при смене IP-адреса.',
            'server.disabled': 'VPN-сервер отключён',
            'server.noUsersWarning': 'Нет пользователей — подключение невозможно. Добавьте пользователя для активации VPN-сервера.',
            'server.started': 'VPN-сервер запущен',
            'server.stoppedMsg': 'VPN-сервер остановлен',
            'server.restarted': 'VPN-сервер перезапущен',
            'server.userAdded': 'Пользователь "{name}" добавлен',
            'server.userDeleted': 'Пользователь "{name}" удалён',
            'server.userRenamed': 'Пользователь "{old}" переименован в "{new}"',
            'server.confirmDelete': 'Удалить пользователя "{name}"?',
            'server.enterNewName': 'Новое имя для "{name}":',
            'server.confirmRegenerate': 'Сгенерировать новые данные для "{name}"? Старые перестанут работать.',
            'server.credentialsUpdated': 'Данные для "{name}" обновлены',
            'server.notConfigured': 'VPN-сервер не настроен. Переустановите Split-KVN для автоматической настройки.',
            'server.lanAccess': 'Доступ к панели и домашней сети',
            'server.lanAccessLabel': 'Клиентам VPN-сервера доступно',
            'server.lanAccessOff': 'Нет доступа',
            'server.lanAccessPanel': 'Только панель',
            'server.lanAccessLan': 'Панель и домашняя сеть',
            'server.lanAccessHint': 'Нужен пароль панели. Интернет-трафик клиентов VPN-сервера идёт по политике сегмента «VPN-сервер» и от этой настройки не зависит.',
            'server.lanAccessSaved': 'Доступ для клиентов VPN-сервера сохранён',
            'server.lanAccessInactive': 'Сейчас выключен: у панели нет пароля (после восстановления или переустановки). Задайте пароль и нажмите «Применить» ещё раз.',
            'server.lanAccessPanelAddress': 'С телефона, подключённого к VPN-серверу, панель открывается по адресу',
            'server.lanAccessPanelOr': 'если имя не откроется:',
            'server.lanAccessDisablePasswordConfirm': 'Клиентам VPN-сервера открыта панель. Без пароля панель и настройки роутера будут доступны любому, кто подключён к VPN-серверу. Отключайте пароль, только если доверяете всем пользователям VPN-сервера на 100%. Отключить?',
            'server.userActive': 'Пользователь активен',
            'server.userSuspended': 'Пользователь приостановлен',
            'server.suspendBtn': 'Приостановить',
            'server.activateBtn': 'Активировать',
            'server.userSuspendedMsg': 'Пользователь "{name}" приостановлен',
            'server.userResumedMsg': 'Пользователь "{name}" возобновлён',
            'server.unavailable': 'Недоступен',
            'server.notDetermined': 'не определён',
            'server.behindNat': 'Роутер за NAT',
            'server.behindNatProbable': 'Роутер, вероятно, за NAT',
            'server.externalIp': 'Внешний IP',
            'server.externalIpUnknown': 'Не удалось проверить внешний IP (сервисы проверки недоступны). Скорее всего, роутер не имеет прямого внешнего адреса.',
            'server.natWarning': 'Для подключения из интернета роутер должен иметь внешний статический IP-адрес. Обратитесь к провайдеру.',
            'server.directIp': 'Прямой внешний IP',
            'server.directIpInfo': 'Роутер имеет публичный IP — входящие подключения из интернета должны работать',
            'server.path': 'Путь',
            'server.useVlessHint': 'Используйте ссылку vless:// или QR-код для подключения.',
            'server.port': 'Порт сервера',
            'server.portLabel': 'Порт VPN-сервера',
            'server.portHint': 'Допустимые значения: 1024-65535. После смены порта все подключённые VPN-клиенты потеряют соединение и должны будут переподключиться с новым портом.',
            'server.portChangeWarning': 'Все подключённые VPN-клиенты потеряют соединение. Им нужно будет переконфигурировать с новым портом {port}. Продолжить?',
            
            // Settings
            'settings.auth': 'Авторизация',
            'settings.authHint': 'Split-KVN доступен только из локальной сети роутера.',
            'settings.authDisabled': 'Авторизация отключена. Любой пользователь в локальной сети имеет доступ.',
            'settings.enablePassword': 'Включить пароль',
            'settings.disablePassword': 'Отключить пароль',
            'settings.currentPassword': 'Текущий пароль',
            'settings.webInterface': 'Веб-интерфейс',
            'settings.webPort': 'Порт Split-KVN',
            'settings.changePort': 'Изменить',
            'settings.restarting': 'Перезапуск...',
            'settings.portHint': 'Допустимые значения: 1024-65535. После смены порта потребуется перейти по новому адресу.',
            'settings.updates': 'Обновление',
            'settings.autoUpdate': 'Обновляться автоматически',
            'settings.updateInstalled': 'Установлена:',
            'settings.updateAvailable': 'Доступна:',
            'settings.updateCheck': 'Проверить',
            'settings.updateNow': 'Обновить сейчас',
            'settings.updateSource': 'Источник обновлений',
            'settings.updateSourceHint': 'Адрес опубликованного описания выпусков. Пусто — обновления выключены совсем.',
            'settings.updateHeld': 'Этот выпуск ждёт разрешения на раскатку. Кнопка «Обновить сейчас» поставит его всё равно.',
            'settings.updateRunning': 'Идёт обновление, обычно меньше минуты. Панель может ненадолго перезагрузиться.',
            'settings.updateNone': 'Новых выпусков нет.',
            'settings.updateNoSource': 'Источник обновлений не задан.',
            'settings.confirmUpdateNow': 'Поставить доступный выпуск сейчас? Сначала снимается резервная копия, при сбое откат.',
            'updateFail.unreachable': 'Не удалось достучаться до источника обновлений.',
            'updateFail.badManifest': 'Источник ответил чем-то нечитаемым.',
            'updateFail.noSource': 'Источник обновлений не задан.',
            'updateFail.download': 'Архив выпуска не скачался.',
            'updateFail.checksum': 'Контрольная сумма не совпала — архив отвергнут.',
            'updateFail.archive': 'В архиве не установщик, ничего не менялось.',
            'updateFail.backup': 'Резервная копия не получилась, обновление не начиналось.',
            'updateFail.install': 'Установка не удалась, откатились назад.',
            'updateFail.selfCheck': 'После обновления роутер не прошёл проверку, откатились назад.',
            'updateFail.noSha': 'На роутере нет sha256sum, непроверенный код не ставим.',
            'updateFail.tooBig': 'Архив больше ожидаемого, отвергнут.',
            'settings.updateCheckedAt': 'Проверено: {time}',
            'settings.systemInfo': 'Информация о системе',
            'settings.version': 'Версия:',
            'settings.uptime': 'Uptime системы:',
            'settings.memory': 'Память:',
            'settings.disk': 'Диск /opt:',
            'settings.portChangeTitle': '⚠️ Смена порта веб-интерфейса',
            'settings.portChangeMessage': 'После сохранения Split-KVN будет доступен по новому адресу:',
            'settings.portChangeNote': 'Текущая страница перестанет работать. Вам нужно будет перейти по новому адресу.',
            'settings.saveAndRedirect': 'Сохранить и перейти',
            'settings.portChangeSuccess': '✅ Порт изменён',
            'settings.portChangeNowAvailable': 'Split-KVN теперь доступен по адресу:',
            'settings.autoRedirect': 'Автоматический переход через',
            'settings.seconds': 'сек',
            'settings.redirectNow': 'Перейти сейчас',
            'settings.remoteLists': 'Источник удалённых списков',
            'settings.listsSourceUrl': 'Базовый URL для удалённых списков',
            'settings.save': 'Сохранить',
            'settings.resetToDefault': 'Сбросить',
            'settings.listsSourceWarning': '⚠️ Внимание: Удалённый источник должен содержать 4 текстовых файла с точными именами: tcp_udp_domains.txt, udp_domains.txt, tcp_udp_subnets.txt, udp_subnets.txt. Если удалённые списки недоступны, маршрутизация будет использовать только локальные списки (по умолчанию пустые).',
            'settings.confirmResetListsSource': 'Сбросить URL источника удалённых списков к значению по умолчанию?',
            'settings.dangerZone': '⚠️ Опасная зона',
            'settings.dangerZoneDescription': 'Расширенные настройки, которые могут сломать DNS и VPN. Меняйте только если знаете, что делаете.',
            'settings.dnsmasqPort': 'Внутренний порт dnsmasq',
            'settings.dnsmasqPortWarning': '🔴 КРИТИЧНО: Этот порт используется внутри для DNS-маршрутизации. Изменение требует полного перезапуска системы (dnsmasq, iptables, sing-box). Неправильная конфигурация может сломать всё DNS-разрешение. Значение по умолчанию: 5353. Меняйте только при конфликте портов.',
            'settings.confirmChangeDnsmasqPort': 'КРИТИЧНО: Изменение порта dnsmasq на {port} перезапустит все VPN-сервисы. DNS может быть временно недоступен. Текущее значение по умолчанию: {default}. Вы абсолютно уверены?',
            'backup.title': 'Резервная копия',
            'backup.hint': 'Один файл: конфигурации, подписки, активный сервер, пользователи VPN-сервера, ваши списки, политики сегментов и настройки. Пароль панели в него не входит.',
            'backup.download': 'Скачать бэкап',
            'backup.downloadStarted': 'Скачивание бэкапа началось',
            'backup.restoreLabel': 'Восстановить из файла',
            'backup.restoreHwid': 'Восстановить и идентификатор роутера (HWID)',
            'backup.restoreHwidHint': 'Включите при переносе на другой роутер: подписки с защитой по HWID продолжат работать. При восстановлении на этом же роутере оставьте выключенным.',
            'backup.restore': 'Восстановить',
            'backup.warning': 'В файле есть ссылки подписок и ключи серверов: храните его как пароль. Восстановление заменяет все текущие конфигурации и ненадолго прерывает VPN; текущее состояние сначала сохраняется на роутере.',
            'backup.chooseFile': 'Сначала выберите файл бэкапа',
            'backup.confirmRestore': 'Заменить все конфигурации, подписки, пользователей VPN-сервера, списки и настройки содержимым этого файла? VPN прервётся на несколько секунд. Текущее состояние сначала сохранится на роутере.',
            'backup.restored': 'Восстановлено: конфигураций — {configs}, подписок — {subscriptions}, пользователей VPN-сервера — {users}. Перезагрузка...',
            'backup.restoreFailed': 'Восстановление не удалось',
            'backup.empty': 'файл пустой',
            'backup.tooLarge': 'файл слишком большой',
            'backup.notArchive': 'это не архив бэкапа',
            'backup.badEntry': 'в архиве есть посторонние файлы',
            'backup.notManagerBackup': 'это не бэкап VPN Manager',
            'backup.badJson': 'данные в бэкапе повреждены',
            'backup.snapshotFailed': 'не удалось сохранить текущее состояние, ничего не изменено',
            'backup.internal': 'внутренняя ошибка',
            'backup.downloadFailed': 'Не удалось скачать бэкап',
            'settings.logTitle': 'Журнал',
            'settings.logHint': 'Журнал хранится в оперативной памяти роутера, чтобы не изнашивать флешку, и после перезагрузки начинается заново. Раз в сутки предупреждения и ошибки копируются на флешку.',
            'settings.verboseOn': 'Подробный журнал на 1 час',
            'settings.verboseOff': 'Выключить подробный журнал',
            'settings.verboseActiveUntil': 'Подробный журнал включён до {time}: записывается каждое соединение.',
            'settings.verboseInactive': 'Обычный журнал: только предупреждения и ошибки.',
            'settings.verboseConfirm': 'Смена уровня журнала перезапускает sing-box: VPN прервётся на несколько секунд. Продолжить?',
            'settings.verboseEnabled': 'Подробный журнал включён на 1 час',
            'settings.verboseDisabled': 'Подробный журнал выключен',
            'logs.download': 'Скачать',
            'logs.downloadHint': 'Скачать весь журнал текстовым файлом',
            'logs.downloadFailed': 'Не удалось скачать журнал',
            'backup.unauthorized': 'сессия истекла, войдите заново',
            'Authorization required': 'сессия истекла, войдите заново',
            'backup.activeMissing': 'Активного сервера из бэкапа в нём не нашлось, поэтому сейчас сервер не выбран. Выберите его на вкладке VPN.',
            
            // Confirm
            'confirm.areYouSure': 'Вы уверены?',
            
            // Logs additional
            'logs.install': 'Установка',
            'logs.copyLog': 'Копировать лог',
            'logs.copy': 'Копировать',
            'logs.selectLog': 'Выберите лог для просмотра...',
            
            // Import
            'import.title': 'Импорт конфигурации',
            'import.file': 'Файл (.conf)',
            'import.subscription': 'Подписка',
            'import.configUrl': 'URL конфигурации',
            'import.supportedProtocols': 'Поддерживаются: Shadowsocks, VLESS, VMess, Trojan',
            'import.subscriptionUrl': 'URL подписки',
            'import.subscriptionName': 'Название подписки',
            'import.subscriptionNameHint': 'Необязательно. Если не указано, будет определено автоматически.',
            'import.supportedFormats': 'Поддерживаемые форматы подписок',
            'import.supportedServerProtocols': 'Поддерживаемые протоколы серверов',
            'import.autoUpdate': 'Автообновление',
            'import.serversFound': 'Найдено серверов',
            'import.configName': 'Название конфигурации',
            'import.wgConfigFile': 'Файл конфигурации WireGuard',
            'import.selectOrDrag': 'Выберите файл или перетащите сюда',
            'import.pasteContent': 'Или вставьте содержимое файла',
            'import.preview': 'Предпросмотр:',
            'import.validate': 'Проверить',
            'import.addSubscription': 'Добавить подписку',
            'import.label.protocol': 'Протокол',
            'import.label.name': 'Название',
            'import.label.server': 'Сервер',
            'import.label.port': 'Порт',
            'import.label.method': 'Метод',
            'import.label.security': 'Безопасность',
            'import.label.address': 'Адрес',
            
            // QR
            'qr.title': 'QR-код',
            
            // Remote lists additional
            'remoteLists.updated': 'Обновлено',
            
            // Recovery
            'recovery.saveCode': '⚠️ Сохраните код восстановления!',
            'recovery.screenshot': '📱 Сделайте скриншот или сохраните код в мессенджер/заметки.',
            'recovery.needForPassword': 'Этот код понадобится, если вы забудете пароль.',
            'recovery.lostWarning': '⚠️ Если вы потеряете код и забудете пароль, потребуется сброс настроек Split-KVN через SSH.',
            'recovery.iSavedCode': 'Я сохранил код',
            
            // Routing tile
            'routing.refreshSegments': 'Обновить сегменты',
            'routing.showAllSegments': 'Показать все сегменты',
            'routing.hideSegments': 'Скрыть сегменты',
            
            // IPv6 toggle
            'ipv6.toggle': 'Включить/выключить IPv6',
            
            // AmneziaWG
            'awg.description': 'AmneziaWG — модификация WireGuard с обфускацией для обхода DPI. Параметры Jc, Jmin, Jmax, S1, S2, H1-H4 должны совпадать с сервером.',
            'awg.localAddress': 'Локальный адрес',
            'awg.localAddressHint': 'IP-адрес клиента в сети',
            'awg.obfuscationParams': 'Параметры обфускации',
            'awg.minJunk': 'Мин. junk',
            'awg.maxJunk': 'Макс. junk',
            
            // Errors
            'errors.connection': 'Ошибка соединения',
            'errors.network': 'Ошибка сети',
            'errors.loading': 'Ошибка загрузки',
            'errors.saving': 'Ошибка сохранения',
            'errors.deleting': 'Ошибка удаления',
            'errors.unknown': 'Неизвестная ошибка',
            'errors.vpnStart': 'Ошибка запуска VPN',
            'errors.vpnStop': 'Ошибка остановки VPN',
            'errors.noLastActiveConfig': 'Последняя активная конфигурация не найдена. Сначала активируйте VPN конфигурацию.',
            'errors.vpnActivation': 'Ошибка активации',
            'errors.copyFailed': 'Ошибка копирования',
            'errors.readFile': 'Ошибка чтения файла',
            'errors.portRequired': 'Введите номер порта',
            'errors.portRange': 'Порт должен быть в диапазоне 1024-65535',
            'errors.portReserved': 'Порт {port} зарезервирован системой',
            'errors.passwordMismatch': 'Пароли не совпадают',
            'errors.currentPasswordRequired': 'Введите текущий пароль',
            'errors.checkSubscription': 'Сначала проверьте подписку',
            'errors.loadDomains': 'Не удалось загрузить список доменов',
            'errors.loadSubnets': 'Не удалось загрузить список подсетей',
            'errors.loadConfigs': 'Не удалось загрузить конфигурации',
            'errors.policyFailed': 'Ошибка сохранения политики',
            'errors.listBindingSame': 'У двух режимов должны быть разные списки',
            'errors.vpnLanAccessNeedsPassword': 'Сначала задайте пароль панели: без него панель открыта любому пользователю VPN-сервера. Потом пароль можно будет отключить — с предупреждением.',
            'errors.vpnLanAccessPasswordRisk': 'Клиентам VPN-сервера открыта панель: без пароля она доступна им всем.',
            'errors.vpnLanAccessFailed': 'Не удалось сохранить доступ для клиентов VPN-сервера',
            'errors.listBindingFailed': 'Не удалось сохранить списки для режимов',
            'errors.segmentsUpdate': 'Ошибка обновления сегментов',
            'errors.qrModalNotFound': 'Модальное окно QR-кода не найдено',
            'errors.serverStart': 'Ошибка запуска',
            'errors.serverStop': 'Ошибка остановки',
            'errors.serverRestart': 'Ошибка перезапуска',
            'errors.serverAdd': 'Ошибка добавления',
            'errors.serverDelete': 'Ошибка удаления',
            'errors.serverRename': 'Ошибка переименования',
            'errors.serverRegenerate': 'Ошибка регенерации',
            'errors.invalidName': 'Имя может содержать только латинские буквы, цифры, - и _',
            'errors.portChange': 'Ошибка при смене порта',
            'errors.serverPortChange': 'Не удалось изменить порт VPN-сервера',
            'errors.urlRequired': 'URL обязателен',
            'errors.urlInvalid': 'URL должен начинаться с http:// или https://',
            'errors.listsSourceSave': 'Не удалось сохранить URL источника списков',
            'errors.listsSourceReset': 'Не удалось сбросить URL источника списков',
            'errors.dnsmasqPortChange': 'Не удалось изменить порт dnsmasq',
            'errors.withMessage': 'Ошибка: {message}',
            'errors.subscriptionSave': 'Ошибка сохранения подписки',
            'errors.subscriptionUpdate': 'Ошибка обновления подписки',
            'errors.domainExists': 'Домен уже существует в списке',
            'errors.settingsSave': 'Ошибка сохранения настроек',
            'errors.subscriptionIdRequired': 'ID подписки не указан',
            'errors.emptyListServersKept': 'Новый список пуст. Текущие серверы сохранены.',
            'errors.noSupportedServers': 'Не найдено серверов с поддерживаемыми протоколами',
            'errors.singboxStartFailed': 'sing-box не запустился',
            'errors.singboxNotInstalled': 'sing-box не установлен',
            'errors.vpnServerNotConfigured': 'VPN-сервер не настроен',
            'errors.usernameRequired': 'Имя пользователя обязательно',
            'errors.subscriptionLoadFailed': 'Не удалось загрузить подписку. Текущие серверы сохранены.',
            'errors.invalidValue': 'Неверное значение',
            'errors.invalidInterval': 'Неверный интервал. Допустимые: 6, 12, 24',
            'errors.cannotDeleteActiveSubscription': 'Нельзя удалить подписку, пока активен сервер из неё. Сначала остановите VPN.',
            'errors.validationErrors': 'Ошибки валидации',
            'errors.enabledRequired': 'Параметр enabled обязателен',
            'errors.intervalRequired': 'Параметр interval обязателен',
            'errors.paramQRequired': 'Параметр q обязателен',
            'errors.updateScriptNotFound': 'Скрипт обновления не найден',
            'errors.oldNewNameRequired': 'Старое и новое имя пользователя обязательны',
            'errors.specifyUsername': 'Укажите имя пользователя',
            'errors.fileNotFound': 'Файл не найден',
            
            // Success messages
            'success.copied': 'Скопировано',
            'success.codeCopied': 'Код скопирован',
            'success.passwordSet': 'Пароль установлен',
            'success.saved': 'Сохранено',
            'success.deleted': 'Удалено',
            'success.updated': 'Обновлено',
            'success.passwordChanged': 'Пароль успешно изменен',
            'success.authDisabled': 'Авторизация отключена',
            'success.authModeChanged': 'Режим авторизации изменён',
            'success.serverDeleted': 'Сервер удалён',
            'success.configUpdated': 'Конфигурация обновлена',
            'success.configAdded': 'Конфигурация добавлена',
            'success.configDeleted': 'Конфигурация удалена',
            'success.configParsed': 'Конфигурация успешно распарсена',
            'success.configImported': 'Конфигурация импортирована',
            'success.subscriptionDeleted': 'Подписка удалена',
            'success.fileDownloaded': 'Файл скачан',
            'success.rulesUpdated': 'Правила dnsmasq/iptables обновлены',
            'success.iptablesUpdated': 'Правила iptables обновлены',
            'success.portChanged': 'Порт изменён',
            'success.serverPortChanged': 'Порт VPN-сервера успешно изменён',
            'success.updateSourceSaved': 'Источник обновлений сохранён',
            'success.updateStarted': 'Обновление запущено',
            'success.updateDone': 'Обновлено до {version}',
            'success.updateChecked': 'Проверено',
            'success.autoUpdateOn': 'Автообновление включено',
            'success.autoUpdateOff': 'Автообновление выключено',
            'success.listsSourceSaved': 'URL источника удалённых списков сохранён',
            'success.listsSourceReset': 'URL источника удалённых списков сброшен к значению по умолчанию',
            'success.dnsmasqPortChanged': 'Порт dnsmasq изменён. Службы перезапускаются...',
            'success.accessRestored': 'Доступ восстановлен! Войдите с логином admin и паролем admin.',
            'success.copiedToClipboard': 'Скопировано в буфер обмена',
            'success.policyUpdated': 'Политика обновлена',
            'success.listBindingSaved': 'Списки для режимов сохранены',
            'success.segmentsUpdated': 'Сегменты обновлены',
            'success.logCleared': 'Лог очищен',
            'success.allLogsCleared': 'Все логи очищены',
            'success.listsUpdated': 'Списки обновлены ({domains} доменов, {subnets} подсетей)',
            'success.listsUpdatedShort': 'Списки обновлены',
            'success.portClosed': 'Порт 8388 закрыт',
            'success.portOpened': 'Порт 8388 открыт',
            'success.vpnStopped': 'VPN остановлен',
            
            // Info/warning messages
            'info.pleaseWait': 'Подождите, операция выполняется...',
            'info.startingVpn': 'Запускаем VPN...',
            'info.checkingConfig': 'Проверка конфигурации...',
            'info.checkingIp': 'Проверка IP...',
            'info.disablingIpv6': 'Отключение IPv6...',
            'info.enablingIpv6': 'Включение IPv6...',
            'info.closingPort': 'Закрытие порта 8388...',
            'info.openingPort': 'Открытие порта 8388...',
            'info.stoppingVpn': 'Останавливаем VPN...',
            'info.updatingSubscription': 'Обновление подписки...',

            // Subscription
            'subscription.editWarningTitle': 'Редактировать сервер из подписки',
            'subscription.editWarningMessage': 'Этот сервер из подписки. Ваши изменения могут быть перезаписаны при обновлении подписки. Редактируйте только если знаете, что делаете.',
            'subscription.deleteWarningTitle': 'Удалить сервер из подписки',
            'subscription.deleteWarningMessage': 'Этот сервер из подписки "{name}". Он может вернуться при следующем обновлении подписки. Удалить?',
            'subscription.subscription': 'Подписка',
            'subscription.updated': 'Обновлено',
            'subscription.autoEvery': 'Авто: каждые',
            'subscription.hours': 'ч',
            'subscription.days': 'д',
            'subscription.expired': 'Истекла',
            'subscription.expiresIn': 'Истекает через',
            'subscription.trafficUsed': 'Использовано трафика',
            'subscription.downloaded': 'Скачано',
            'subscription.updateInterval': 'Рекомендуемый интервал обновления',
            'subscription.enterUrl': 'Введите URL подписки',
            'subscription.loading': 'Загрузка...',
            'subscription.noServersFound': 'Не найдено серверов с поддерживаемыми протоколами',
            'subscription.andMore': '... и ещё {count} серверов',
            'subscription.addedToast': 'Подписка добавлена ({count} серверов)',
            'subscription.updatedToast': 'Подписка обновлена ({count} серверов)',
            'subscription.deleteTitle': 'Удалить подписку',
            'subscription.deleteMessage': 'Удалить подписку "{name}" и все её серверы?',

            'warning.listEmpty': 'Список пуст',
            'warning.logEmpty': 'Лог пуст',

            // Donate
            'donate.button': 'Донат',
            'donate.title': '{donut_icon} Поддержать проект',
            'donate.message': 'Split-KVN создавался на энтузиазме бессонными ночами. Если проект стал вам полезен, значит силы были вложены не зря.<br><br>Разработчик будет благодарен за вознаграждение на ваше усмотрение в {usdt_icon} USDT (TRC-20).<br><br>Это необязательно, но будет очень приятно =)',
            'donate.copyAddress': 'Скопировать адрес',
            'donate.copied': 'Адрес скопирован!',
            'donate.thankYou': 'Спасибо за вашу поддержку!',
            'donate.close': 'OK'
        }
    };
    
    // Current language (loaded from localStorage or default)
    let currentLanguage = localStorage.getItem('vpn-manager-language') || CONFIG.DEFAULT_LANGUAGE;
    if (!TRANSLATIONS[currentLanguage]) {
        currentLanguage = CONFIG.DEFAULT_LANGUAGE;
    }
    
    /**
     * Get translated string by key
     * @param {string} key - Translation key
     * @param {object} params - Optional parameters for interpolation
     * @returns {string} - Translated string or key if not found
     */
    function t(key, params = {}) {
        const lang = TRANSLATIONS[currentLanguage] || TRANSLATIONS[CONFIG.DEFAULT_LANGUAGE];
        let str = lang[key] || TRANSLATIONS[CONFIG.DEFAULT_LANGUAGE][key] || key;
        
        // Simple parameter interpolation: {param} -> value
        Object.keys(params).forEach(param => {
            str = str.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
        });
        
        return str;
    }
    
    /**
     * Set application language
     * @param {string} lang - Language code ('en' or 'ru')
     */
    function setLanguage(lang) {
        if (!TRANSLATIONS[lang]) {
            console.warn(`Language '${lang}' not supported, falling back to ${CONFIG.DEFAULT_LANGUAGE}`);
            lang = CONFIG.DEFAULT_LANGUAGE;
        }
        
        currentLanguage = lang;
        localStorage.setItem('vpn-manager-language', lang);
        
        // Update all DOM elements with data-i18n attribute
        updatePageTranslations();
        // B1: texts the Domains/Subnets tabs render themselves
        updateListModeUI();
        // Multi mode: tile, apply bar and config-list checkboxes are rendered by JS
        if (multiState.available) {
            renderMultiUI();
            if (state.configs.length > 0) renderConfigs();
        }
        
        // Update language selector
        const langSelect = document.getElementById('language-select');
        if (langSelect) {
            langSelect.value = lang;
        }
        
        // Notify backend about language change (for logs)
        fetch(`${CONFIG.API_BASE}/settings.cgi/language`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: lang })
        }).catch(() => {}); // Ignore errors
    }
    
    /**
     * Update all DOM elements with translations
     */
    function updatePageTranslations() {
        // Update elements with data-i18n attribute (text content)
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = t(key);
        });
        
        const ICON_PARAMS = {
            usdt_icon: '<svg class="tether-icon" viewBox="0 0 339.43 295.27" width="16" height="14" style="vertical-align:-2px"><path fill="#50af95" d="M62.15 1.45l-61.89 130a2.52 2.52 0 0 0 .54 2.94l167.15 160.17a2.55 2.55 0 0 0 3.53 0L338.63 134.4a2.52 2.52 0 0 0 .54-2.94l-61.89-130A2.5 2.5 0 0 0 275 0H64.45a2.5 2.5 0 0 0-2.3 1.45z"/><path fill="#fff" d="M191.19 144.8v-.12c-1.2.09-7.4.46-21.23.46-11 0-18.81-.33-21.55-.46v.13c-42.51-1.87-74.24-9.27-74.24-18.13s31.73-16.25 74.24-18.15v28.91c2.78.2 10.74.67 21.74.67 13.2 0 19.81-.55 21-.66v-28.9c42.42 1.89 74.08 9.29 74.08 18.13s-31.65 16.29-74.08 18.12zm0-39.25V79.68h59.2V40.23H89.21v39.45h59.19v25.86c-48.11 2.17-84.29 11.74-84.29 23.16S100.29 150.87 148.4 153v64.82h42.79V153c48-2.15 84.07-11.71 84.07-23.12s-36.09-20.96-84.07-23.13z"/></svg>',
            donut_icon: '<svg viewBox="0 0 100 100" width="22" height="22" style="vertical-align:-4px"><circle cx="50" cy="50" r="42" fill="#d4a574"/><circle cx="50" cy="50" r="18" fill="#1e1e2e"/><path d="M8 45c0-23.2 18.8-42 42-42s42 18.8 42 42c0 3-1.5 5-4 5-3 0-4-3-6-5s-5-4-8-4-6 2-8 4-3 5-6 5-5-3-7-5-5-4-8-4-6 2-8 4-3 5-6 5-5-3-7-5-5-4-8-4-6 2-8 4-4 5-7 5c-2.5 0-4-2-4-5z" fill="#ff69b4"/><circle cx="50" cy="50" r="18" fill="#1e1e2e"/></svg>'
        };
        // Update elements with data-i18n-html attribute (allows HTML/SVG inside)
        document.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            el.innerHTML = t(key, ICON_PARAMS);
        });
        
        // Update elements with data-i18n-placeholder (input placeholders)
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = t(key);
        });
        
        // Update elements with data-i18n-title (tooltips)
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = t(key);
        });
        
        // Update document title
        document.title = t('app.title');
    }
    
    /**
     * Get current language code
     * @returns {string} - Current language code
     */
    function getCurrentLanguage() {
        return currentLanguage;
    }

    // ============================================
    // State
    // ============================================
    const state = {
        authenticated: false,
        firstLogin: false,
        currentTab: 'vpn',
        currentDomainsSubtab: 'domains-tcpudp',
        currentSubnetsSubtab: 'subnets-tcpudp',
        configs: [],
        subscriptions: [],
        activeConfig: null,
        vpnRunning: false,
        // devices: [], — DISABLED
        domainsTcpUdpOriginal: '',
        domainsUdpOnlyOriginal: '',
        subnetsTcpUdpOriginal: '',
        subnetsUdpOnlyOriginal: '',
        statusInterval: null,
        checkInterval: null,
        ssserver: {
            configured: false,
            running: false,
            users: []
        },
        currentLogName: 'sing-box',
        autostart: false,
        listMode: 'split', // B1: mode tab shown on Domains/Subnets tabs
        listSet: 'world' // B1: list set on screen = listBinding[listMode]
    };

    // B1: list sets. World is the original one; Russia is sent as listset=russia.
    // The UI shows them by list name (the same in both languages).
    const LIST_SETS = ['world', 'russia'];
    const LIST_SET_NAMES = { world: 'ruunblockdomains', russia: 'ruservices' };
    const LIST_MODES = ['split', 'vpnprimary'];
    const LIST_MODE_STORAGE_KEY = 'vpn-manager-listmode';
    // Which set each mode uses (server defaults until settings.cgi answers)
    let listBinding = { split: 'world', vpnprimary: 'russia' };
    try {
        if (localStorage.getItem(LIST_MODE_STORAGE_KEY) === 'vpnprimary') state.listMode = 'vpnprimary';
    } catch (_) {}
    state.listSet = listBinding[state.listMode];
    
    // ============================================
    // Utility Functions
    // ============================================
    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }
    
    // ============================================
    // Protocol Definitions
    // ============================================
    const PROTOCOLS = {
        shadowsocks: {
            name: 'Shadowsocks',
            fields: ['ss_password', 'ss_method', 'ss_udp_over_tcp']
        },
        vless: {
            name: 'VLESS',
            fields: ['vless_uuid', 'vless_flow', 'vless_tls', 'vless_sni', 'vless_security', 'vless_public_key', 'vless_short_id']
        },
        vmess: {
            name: 'VMess',
            fields: ['vmess_uuid', 'vmess_alter_id', 'vmess_security', 'vmess_tls', 'vmess_sni']
        },
        trojan: {
            name: 'Trojan',
            fields: ['trojan_password', 'trojan_sni', 'trojan_skip_verify']
        },
        wireguard: {
            name: 'WireGuard',
            fields: ['wg_private_key', 'wg_peer_public_key', 'wg_local_address', 'wg_preshared_key', 'wg_mtu']
        },
        amneziawg: {
            name: 'AmneziaWG',
            fields: ['awg_private_key', 'awg_peer_public_key', 'awg_local_address', 'awg_preshared_key', 'awg_mtu', 
                     'awg_jc', 'awg_jmin', 'awg_jmax', 'awg_s1', 'awg_s2', 'awg_h1', 'awg_h2', 'awg_h3', 'awg_h4']
        },
        hysteria2: {
            name: 'Hysteria2',
            fields: ['hy2_password', 'hy2_sni', 'hy2_up_mbps', 'hy2_down_mbps', 'hy2_skip_verify', 'hy2_obfs_password']
        }
    };

    // ============================================
    // DOM Elements
    // ============================================
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);

    const elements = {
        loginScreen: $('#login-screen'),
        changePasswordScreen: $('#change-password-screen'),
        authSetupScreen: $('#auth-setup-screen'),
        recoveryScreen: $('#recovery-screen'),
        mainScreen: $('#main-screen'),
        loginForm: $('#login-form'),
        loginError: $('#login-error'),
        changePasswordForm: $('#change-password-form'),
        passwordError: $('#password-error'),
        logoutBtn: $('#logout-btn'),
        settingsBtn: $('#settings-btn'),
        
        // Recovery
        forgotPasswordLink: $('#forgot-password-link'),
        recoveryForm: $('#recovery-form'),
        recoveryCodeInput: $('#recovery-code-input'),
        recoveryError: $('#recovery-error'),
        backToLoginLink: $('#back-to-login-link'),
        recoveryCodeModal: $('#recovery-code-modal'),
        recoveryCodeDisplay: $('#recovery-code-display'),
        copyRecoveryCodeBtn: $('#copy-recovery-code-btn'),
        recoveryCodeConfirmBtn: $('#recovery-code-confirm-btn'),
        
        // Onboarding
        onboardingTooltip: $('#onboarding-tooltip'),
        onboardingDismiss: $('#onboarding-dismiss'),
        
        tabs: $$('.tab'),
        tabContents: $$('.tab-content'),
        
        vpnStatusIndicator: $('#vpn-status-indicator'),
        statusBadge: $('#status-badge'),
        statusDetails: $('#status-details'),
        configList: $('#config-list'),
        addConfigBtn: $('#add-config-btn'),
        autostartToggle: $('#autostart-toggle'),
        
        // Domains - TCP+UDP
        domainsEditorTcpUdp: $('#domains-editor-tcpudp'),
        lineNumbersTcpUdp: $('#line-numbers-tcpudp'),
        domainsValidationTcpUdp: $('#domains-validation-tcpudp'),
        domainsSaveTcpUdpBtn: $('#domains-save-tcpudp-btn'),
        
        // Domains - UDP-only
        domainsEditorUdpOnly: $('#domains-editor-udponly'),
        lineNumbersUdpOnly: $('#line-numbers-udponly'),
        domainsValidationUdpOnly: $('#domains-validation-udponly'),
        domainsSaveUdpOnlyBtn: $('#domains-save-udponly-btn'),
        
        domainsStats: $('#domains-stats'),
        
        // Subnets - TCP+UDP
        subnetsEditorTcpUdp: $('#subnets-editor-tcpudp'),
        lineNumbersSubnetsTcpUdp: $('#line-numbers-subnets-tcpudp'),
        subnetsValidationTcpUdp: $('#subnets-validation-tcpudp'),
        subnetsSaveTcpUdpBtn: $('#subnets-save-tcpudp-btn'),
        
        // Subnets - UDP-only
        subnetsEditorUdpOnly: $('#subnets-editor-udponly'),
        lineNumbersSubnetsUdpOnly: $('#line-numbers-subnets-udponly'),
        subnetsValidationUdpOnly: $('#subnets-validation-udponly'),
        subnetsSaveUdpOnlyBtn: $('#subnets-save-udponly-btn'),
        
        subnetsStats: $('#subnets-stats'),
        subnetsSubtabs: $$('#subnets-subtabs .subtab'),
        
        // Domains-page tabs only (data-subtab): viewer tabs and the list set switch
        // in the modals are .subtab too and must not switch the page's panels
        subtabs: $$('.subtab[data-subtab]'),
        subtabContents: $$('.subtab-content'),
        
        // deviceList: $('#device-list'), — DISABLED
        // addDeviceBtn: $('#add-device-btn'), — DISABLED
        
        modalOverlay: $('#modal-overlay'),
        configModal: $('#config-modal'),
        configForm: $('#config-form'),
        // deviceModal: $('#device-modal'), — DISABLED
        // deviceForm: $('#device-form'), — DISABLED
        settingsModal: $('#settings-modal'),
        confirmModal: $('#confirm-modal'),
        
        toastContainer: $('#toast-container')
    };

    // ============================================
    // API Functions
    // ============================================
    async function api(endpoint, options = {}) {
        const url = CONFIG.API_BASE + endpoint;
        
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                credentials: 'same-origin'
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || t('errors.unknown'));
            }
            
            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    // ============================================
    // Toast Notifications
    // ============================================
    function showToast(message, type = 'info', duration = 5000) {
        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type]}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close">&times;</button>
        `;
        
        elements.toastContainer.appendChild(toast);
        
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => removeToast(toast));
        
        setTimeout(() => removeToast(toast), duration);
    }

    function removeToast(toast) {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }

    // ============================================
    // Modal Functions
    // ============================================
    function showModal(modal) {
        elements.modalOverlay.classList.remove('hidden');
        modal.classList.remove('hidden');
        // Update translations for dynamic content in modal
        updatePageTranslations();
    }

    function hideModal(modal) {
        modal.classList.add('hidden');
        if (!$$('.modal:not(.hidden)').length) {
            elements.modalOverlay.classList.add('hidden');
        }
        // The update poll only exists to refresh a visible screen; a closed
        // settings window must not keep asking the router every ten seconds.
        if (typeof stopUpdatePolling === 'function') stopUpdatePolling();
    }

    function hideAllModals() {
        $$('.modal').forEach(m => m.classList.add('hidden'));
        elements.modalOverlay.classList.add('hidden');
        if (typeof stopUpdatePolling === 'function') stopUpdatePolling();
    }

    // ============================================
    // Authentication
    // ============================================
    async function checkAuth() {
        try {
            const data = await api('/auth.cgi/check');
            state.authenticated = data.data?.authenticated || false;
            state.authMode = data.data?.auth_mode || 'disabled';
            state.onboardingShown = data.data?.onboarding_shown || false;
            
            // Auth disabled — go straight to interface
            if (state.authMode === 'disabled') {
                state.authenticated = true;
                    showScreen('main');
                    initApp();
                
                // Show tooltip on first login (with delay for DOM)
                if (!state.onboardingShown) {
                    setTimeout(() => showOnboardingTooltip(), 500);
                }
                return;
            }
            
            if (state.authenticated) {
                showScreen('main');
                initApp();
            } else {
                showScreen('login');
            }
        } catch (error) {
            // On check error — try to enter without auth
            showScreen('main');
            initApp();
        }
    }
    
    function showOnboardingTooltip() {
        if (elements.onboardingTooltip) {
            elements.onboardingTooltip.classList.remove('hidden');
        }
    }
    
    async function dismissOnboarding() {
        if (elements.onboardingTooltip) {
            elements.onboardingTooltip.classList.add('hidden');
        }
        try {
            await api('/auth.cgi/dismiss-onboarding', { method: 'POST' });
        } catch (e) {
            // Ignore
        }
    }

    async function login(username, password) {
        try {
            const data = await api('/auth.cgi/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            
            if (data.success) {
                state.authenticated = true;
                state.authMode = data.auth_mode || 'password';
                
                if (state.authMode === 'first_login') {
                    showScreen('auth-setup');
                } else {
                    // A real page load after sign-in lets browsers see a finished
                    // login and offer to save the password; the session cookie
                    // brings the panel straight back.
                    window.location.reload();
                }
            }
        } catch (error) {
            throw error;
        }
    }

    async function logout() {
        try {
            await api('/auth.cgi/logout');
        } catch (e) {
            // Ignore
        }
        
        state.authenticated = false;
        clearIntervals();
        showScreen('login');
    }

    async function changePassword(newPassword) {
        const data = await api('/auth.cgi/change-password', {
            method: 'POST',
            body: JSON.stringify({
                current_password: 'admin',
                new_password: newPassword
            })
        });
        
        if (data.success) {
            state.authMode = 'password';
            showScreen('main');
            initApp();
            showToast(t('success.passwordChanged'), 'success');
        }
    }

    // Initial auth mode setup
    async function setupAuth(mode, password = null) {
        const body = { mode };
        if (password) {
            body.password = password;
        }
        
        const data = await api('/auth.cgi/setup', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        
        if (data.success) {
            state.authMode = mode;
            
            // If password is set — show recovery code
            if (mode === 'password' && data.data?.recovery_code) {
                showRecoveryCodeModal(data.data.recovery_code);
            } else {
                showScreen('main');
                initApp();
                showToast(t('success.authDisabled'), 'success');
            }
        }
    }
    
    // Show recovery code modal
    function showRecoveryCodeModal(code) {
        // First hide all other modals
        hideAllModals();
        
        if (elements.recoveryCodeDisplay) {
            elements.recoveryCodeDisplay.textContent = code;
        }
        showModal(elements.recoveryCodeModal);
    }

    // Change auth mode (from settings)
    async function changeAuthMode(mode, password = null, currentPassword = null, confirmVpnRisk = false) {
        const body = { mode };
        if (password) body.password = password;
        if (currentPassword) body.current_password = currentPassword;
        // B8: the router refuses to drop the password while VPN clients can reach the panel,
        // unless the user has confirmed the warning
        if (confirmVpnRisk) body.confirm_vpn_risk = 'true';
        
        const data = await api('/auth.cgi/change-mode', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        
        if (data.success) {
            state.authMode = mode;
            
            // If password enabled — show recovery code
            if (mode === 'password' && data.data?.recovery_code) {
                showRecoveryCodeModal(data.data.recovery_code);
            }
            showToast(t('success.authModeChanged'), 'success');
            return true;
        }
        return false;
    }

    // ============================================
    // Screen Management
    // ============================================
    function showScreen(screen) {
        elements.loginScreen.classList.add('hidden');
        elements.changePasswordScreen.classList.add('hidden');
        elements.authSetupScreen?.classList.add('hidden');
        elements.recoveryScreen?.classList.add('hidden');
        elements.mainScreen.classList.add('hidden');
        
        switch (screen) {
            case 'login':
                elements.loginScreen.classList.remove('hidden');
                break;
            case 'change-password':
                elements.changePasswordScreen.classList.remove('hidden');
                break;
            case 'auth-setup':
                elements.authSetupScreen?.classList.remove('hidden');
                break;
            case 'recovery':
                elements.recoveryScreen?.classList.remove('hidden');
                break;
            case 'main':
                elements.mainScreen.classList.remove('hidden');
                break;
        }
    }

    // ============================================
    // Tab Navigation
    // ============================================
    function switchTab(tabName) {
        state.currentTab = tabName;
        
        elements.tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        
        elements.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tabName}`);
        });
        
        // Load tab data if needed
        switch (tabName) {
            case 'vpn':
                loadConfigs();
                if (window.VPNFailover?.reload) window.VPNFailover.reload();
                loadMultiState();
                break;
            case 'domains':
            case 'subnets':
                openListsTab(tabName); // B1: binding first, it decides which set is loaded
                break;
            // case 'devices': — DISABLED
            //     loadDevices();
            //     break;
            case 'server':
                loadSSServerStatus();
                loadVpnLanAccess();
                break;
        }
    }

    // ============================================
    // VPN Status
    // ============================================
    async function loadStatus() {
        try {
            const data = await api('/status.cgi');
            
            if (data.success && data.data) {
                updateStatusDisplay(data.data);
            }
            
            // Load traffic stats separately
            loadTrafficStats();
        } catch (error) {
            console.error('Failed to load status:', error);
        }
    }
    
    async function loadTrafficStats() {
        try {
            const data = await api('/status.cgi/traffic');
            
            if (data.success && data.data) {
                updateTrafficDisplay(data.data);
            }
        } catch (error) {
            // Not critical if failed
            console.log('Traffic stats unavailable');
        }
    }
    
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    function updateTrafficDisplay(data) {
        const upEl = $('#traffic-up');
        const downEl = $('#traffic-down');
        const connEl = $('#traffic-conn');
        
        if (upEl) upEl.textContent = formatBytes(data.upload);
        if (downEl) downEl.textContent = formatBytes(data.download);
        if (connEl) connEl.textContent = data.connections || '0';
        
        // Show/hide block depending on API availability
        const footer = $('#traffic-stats');
        if (footer) {
            footer.style.opacity = data.api_available ? '1' : '0.5';
        }
    }

    function updateStatusDisplay(data) {
        const vpn = data.vpn || {};
        const isRunning = vpn.singbox_status === 'running';
        state.vpnRunning = isRunning;
        
        // Update Device ID in header
        const deviceIdValue = $('#device-id-value');
        const deviceIdBadge = $('#device-id-badge');
        if (deviceIdValue && data.system?.device_id) {
            deviceIdValue.textContent = data.system.device_id;
            state.deviceId = data.system.device_id;
            // Copy to clipboard on click
            if (!deviceIdBadge._clickHandler) {
                deviceIdBadge._clickHandler = true;
                deviceIdBadge.addEventListener('click', () => {
                    copyToClipboard(state.deviceId);
                });
            }
        }
        
        // Update footer version
        const footerVersion = $('#footer-version');
        if (footerVersion && data.version) {
            footerVersion.textContent = `Split-KVN v${data.version}`;
        }
        
        // Update header indicator
        elements.vpnStatusIndicator.className = `status-indicator ${isRunning ? 'running' : 'stopped'}`;
        elements.vpnStatusIndicator.querySelector('.status-text').textContent = 
            isRunning ? t('header.vpnActive') : t('header.vpnStopped');
        
        // Update status badge
        elements.statusBadge.className = `status-badge ${isRunning ? 'running' : 'stopped'}`;
        elements.statusBadge.querySelector('.badge-text').textContent = 
            isRunning ? t('vpn.status.running') : t('vpn.status.stopped');
        
        // Update Start/Stop VPN buttons visibility
        const startVpnBtn = $('#start-vpn-btn');
        const stopVpnBtn = $('#stop-vpn-btn');
        if (startVpnBtn && stopVpnBtn) {
            if (isRunning) {
                startVpnBtn.style.display = 'none';
                stopVpnBtn.style.display = '';
            } else {
                startVpnBtn.style.display = '';
                stopVpnBtn.style.display = 'none';
            }
        }
        
        // Update status details
        const domains = data.domains || {};
        const configs = data.configs || {};
        // const devices = data.devices || {}; — DISABLED
        
        let uptimeText = '—';
        if (vpn.uptime) {
            const hours = Math.floor(vpn.uptime / 3600);
            const minutes = Math.floor((vpn.uptime % 3600) / 60);
            uptimeText = `${hours}${t('time.h')} ${minutes}${t('time.min')}`;
        }
        
        elements.statusDetails.innerHTML = `
            <div class="status-grid">
                <div class="status-item">
                    <div class="status-item-label">${t('vpn.activeConfig')}</div>
                    <div class="status-item-value" title="${vpn.active_config || ''}">${vpn.active_config || '—'}</div>
                </div>
                <div class="status-item">
                    <div class="status-item-label">${t('vpn.uptime')}</div>
                    <div class="status-item-value">${uptimeText}</div>
                </div>
                <div class="status-item">
                    <div class="status-item-label">${t('vpn.server')}</div>
                    <div class="status-item-value" title="${vpn.server ? `${vpn.server}:${vpn.port}` : ''}">${vpn.server ? `${vpn.server}:${vpn.port}` : '—'}</div>
                </div>
                <div class="status-item">
                    <div class="status-item-label">${t('vpn.configsCount')}</div>
                    <div class="status-item-value">${configs.total || 0}</div>
                </div>
                <div class="status-item">
                    <div class="status-item-label">${t('vpn.domainsCount')}</div>
                    <div class="status-item-value">${domains.domains || 0}</div>
                </div>
            </div>
        `;
        
        // Update state
        if (vpn.active_config) {
            state.activeConfig = vpn.active_config;
            state.lastActiveConfig = vpn.active_config; // Save last active for restart
        }
        
        // Re-render configs to update buttons
        if (state.configs.length > 0) {
            renderConfigs();
        }
    }

    // ============================================
    // VPN Configurations
    // ============================================
    async function loadConfigs() {
        try {
            const data = await api('/vpn.cgi');
            
            if (data.success) {
                state.configs = data.data.configs || [];
                state.activeConfig = data.data.active;
                renderConfigs();
            }
        } catch (error) {
            elements.configList.innerHTML = `
                <div class="empty-state">
                    <p>${t('errors.loadConfigs')}</p>
                    <button class="btn btn-secondary" onclick="loadConfigs()">${t('actions.retry')}</button>
                </div>
            `;
        }
    }

    // Track expanded subscriptions
    const expandedSubscriptions = new Set();

    function renderConfigs() {
        if (state.configs.length === 0) {
            elements.configList.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2"/>
                        <path d="M7 11V7a5 5 0 0110 0v4"/>
                    </svg>
                    <p>${t('vpn.noConfigs')}</p>
                    <button class="btn btn-primary" id="empty-add-config">${t('vpn.import')}</button>
                </div>
            `;
            
            $('#empty-add-config')?.addEventListener('click', () => openImportModal());
            return;
        }
        
        // Group configs by subscription
        const standaloneConfigs = state.configs.filter(c => !c.subscription_id);
        const subscriptionConfigs = {};
        
        state.configs.filter(c => c.subscription_id).forEach(config => {
            if (!subscriptionConfigs[config.subscription_id]) {
                subscriptionConfigs[config.subscription_id] = [];
            }
            subscriptionConfigs[config.subscription_id].push(config);
        });
        
        let html = '';
        
        // Render subscriptions
        const subscriptions = state.subscriptions || [];
        subscriptions.forEach(sub => {
            const subConfigs = subscriptionConfigs[sub.id] || [];
            if (subConfigs.length === 0) return;
            
            const isExpanded = expandedSubscriptions.has(sub.id);
            const activeConfig = subConfigs.find(c => String(c.id) === String(state.activeConfig));
            const hasActiveServer = !multiOn() && activeConfig && state.vpnRunning;
            
            html += `
                <div class="subscription-group ${isExpanded ? 'expanded' : ''}" data-subscription-id="${sub.id}">
                    <div class="subscription-header" data-action="toggle">
                        ${multiOn() ? renderMultiSubCheck(sub, subConfigs) : ''}
                        <span class="subscription-toggle">${isExpanded ? '▼' : '▶'}</span>
                        <span class="subscription-name">${escapeHtml(sub.name)}</span>
                        ${multiOn() ? renderMultiSubNote(sub, subConfigs) : ''}
                        ${hasActiveServer ? `
                            <span class="subscription-active-server">
                                <span class="status-dot running"></span>
                                ${escapeHtml(activeConfig.name)}
                            </span>
                        ` : ''}
                        ${!isExpanded && subConfigs.length > 1 ? `
                            <span class="subscription-count">+${subConfigs.length - (hasActiveServer ? 1 : 0)} ${t('vpn.servers').toLowerCase()}</span>
                        ` : ''}
                        <div class="subscription-actions">
                            <button class="btn btn-sm btn-icon" data-action="refresh" title="${t('success.updated')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="23 4 23 10 17 10"/>
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                                </svg>
                            </button>
                            <button class="btn btn-sm btn-icon" data-action="delete-sub" title="${t('vpn.delete')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="subscription-servers ${isExpanded ? '' : 'hidden'}">
                        ${subConfigs.map(config => renderConfigItem(config, true)).join('')}
                    </div>
                    <div class="subscription-footer">
                        ${renderSubscriptionMetadata(sub.metadata)}
                        <span class="sub-footer-updated">${t('subscription.updated')}: ${formatDate(sub.updated_at)} ${sub.auto_update ? `• ${t('subscription.autoEvery')} ${sub.update_interval}${t('subscription.hours')}` : ''}</span>
                    </div>
                </div>
            `;
        });
        
        // Render standalone configs
        html += standaloneConfigs.map(config => renderConfigItem(config, false)).join('');
        
        elements.configList.innerHTML = html;
        
        // Add event listeners for subscription groups
        elements.configList.querySelectorAll('.subscription-group').forEach(group => {
            const subId = group.dataset.subscriptionId;
            
            group.querySelector('.subscription-header')?.addEventListener('click', (e) => {
                if (e.target.closest('[data-action]') && e.target.closest('[data-action]').dataset.action !== 'toggle') return;
                toggleSubscription(subId);
            });
            
            group.querySelector('[data-action="refresh"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                refreshSubscription(subId);
            });
            
            group.querySelector('[data-action="delete-sub"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSubscription(subId);
            });
        });
        
        // Multi mode: checkboxes instead of Play (no-op in single mode)
        if (multiOn()) bindMultiChecks(elements.configList);
        
        // Add event listeners for config items
        elements.configList.querySelectorAll('.config-item').forEach(item => {
            const id = item.dataset.id;
            const isFromSubscription = item.closest('.subscription-group') !== null;
            
            item.querySelector('[data-action="activate"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                activateConfig(id);
            });
            
            item.querySelector('[data-action="stop"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                stopConfig(id);
            });
            
            item.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isFromSubscription) {
                    showSubscriptionEditWarning(() => editConfig(id));
                } else {
                    editConfig(id);
                }
            });
            
            item.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isFromSubscription) {
                    showSubscriptionDeleteWarning(id);
                } else {
                    deleteConfig(id);
                }
            });
        });
    }
    
    function renderConfigItem(config, isFromSubscription) {
            const isActive = String(config.id) === String(state.activeConfig);
            const isRunning = isActive && state.vpnRunning;
        let protocolLabel = PROTOCOLS[config.protocol]?.name || config.protocol || 'ss';
        if (config.transport_type && config.transport_type !== 'none' && config.transport_type !== '') {
            protocolLabel += '+' + config.transport_type;
        }
            
            return `
            <div class="config-item ${(multiOn() ? multiIsSelected(config) : isActive) ? 'active' : ''} ${isFromSubscription ? 'from-subscription' : ''}" data-id="${config.id}">
                    <div class="config-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2"/>
                            <path d="M7 11V7a5 5 0 0110 0v4"/>
                        </svg>
                    </div>
                    <div class="config-info">
                        <div class="config-name">${escapeHtml(config.name)}</div>
                    <div class="config-server">
                        <span class="config-protocol">${protocolLabel}</span>
                        ${escapeHtml(config.server)}:${config.server_port}
                        ${multiOn() ? renderMultiRowTags(config) : ''}
                    </div>
                    </div>
                    <div class="config-actions">
                        ${multiOn() ? renderMultiCheck(config) : isRunning ? `
                            <button class="btn btn-sm btn-secondary" data-action="stop" title="${t('vpn.stop')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="6" y="6" width="12" height="12"/>
                                </svg>
                            </button>
                        ` : `
                            <button class="btn btn-sm btn-primary" data-action="activate" title="${t('vpn.activate')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                </svg>
                            </button>
                        `}
                        <button class="btn btn-sm btn-icon" data-action="edit" title="${t('vpn.edit')}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="btn btn-sm btn-icon" data-action="delete" title="${t('vpn.delete')}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
    }
    
    function toggleSubscription(subId) {
        if (expandedSubscriptions.has(subId)) {
            expandedSubscriptions.delete(subId);
        } else {
            expandedSubscriptions.add(subId);
        }
        renderConfigs();
    }
    
    function showSubscriptionEditWarning(callback) {
        $('#confirm-title').textContent = t('subscription.editWarningTitle');
        $('#confirm-message').textContent = t('subscription.editWarningMessage');
        
        const okBtn = $('#confirm-ok');
        const cancelBtn = $('#confirm-cancel');
        
        okBtn.textContent = t('vpn.edit');
        cancelBtn.textContent = t('dialog.cancel');
        
        showModal(elements.confirmModal);
        
        const handler = () => {
            okBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            hideModal(elements.confirmModal);
            callback();
        };
        
        const cancelHandler = () => {
            okBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            hideModal(elements.confirmModal);
        };
        
        okBtn.addEventListener('click', handler);
        cancelBtn.addEventListener('click', cancelHandler);
    }
    
    function showSubscriptionDeleteWarning(configId) {
        const config = state.configs.find(c => c.id === configId);
        const sub = state.subscriptions?.find(s => s.id === config?.subscription_id);
        
        $('#confirm-title').textContent = t('subscription.deleteWarningTitle');
        $('#confirm-message').textContent = t('subscription.deleteWarningMessage').replace('{name}', sub?.name || t('subscription.subscription'));
        
        const okBtn = $('#confirm-ok');
        const cancelBtn = $('#confirm-cancel');
        
        okBtn.textContent = t('vpn.delete');
        cancelBtn.textContent = t('dialog.cancel');
        
        showModal(elements.confirmModal);
        
        const handler = async () => {
            okBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            
            try {
                await api(`/vpn.cgi/${configId}`, { method: 'DELETE' });
                showToast(t('success.serverDeleted'), 'success');
                hideModal(elements.confirmModal);
                loadConfigs();
                loadStatus();
            } catch (err) {
                showToast(t(err.message) || t('errors.deleting'), 'error');
            }
        };
        
        const cancelHandler = () => {
            okBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            hideModal(elements.confirmModal);
        };
        
        okBtn.addEventListener('click', handler);
        cancelBtn.addEventListener('click', cancelHandler);
    }
    
    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            const locale = currentLanguage === 'ru' ? 'ru-RU' : 'en-US';
            return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch {
            return dateStr;
        }
    }

    // Format traffic size (bytes → human readable)
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Format subscription expiry (unix timestamp → days until expiry)
    function formatExpire(timestamp) {
        if (!timestamp) return null;
        const now = Math.floor(Date.now() / 1000);
        const diff = timestamp - now;
        
        if (diff <= 0) return { text: t('subscription.expired'), class: 'expired' };
        
        const days = Math.floor(diff / 86400);
        const hours = Math.floor((diff % 86400) / 3600);
        
        if (days > 30) {
            return { text: `${days} ${t('subscription.days')}`, class: 'ok' };
        } else if (days > 7) {
            return { text: `${days} ${t('subscription.days')}`, class: 'warning' };
        } else if (days > 0) {
            return { text: `${days} ${t('subscription.days')} ${hours} ${t('subscription.hours')}`, class: 'critical' };
        } else {
            return { text: `${hours} ${t('subscription.hours')}`, class: 'critical' };
        }
    }

    // Render subscription metadata (universal)
    function renderSubscriptionMetadata(metadata) {
        if (!metadata) return '';
        
        let parts = [];
        
        // 1. Expire from subscription-userinfo (standard format — unix timestamp)
        if (metadata.expire) {
            const exp = formatExpire(metadata.expire);
            if (exp) {
                parts.push(`<span class="sub-meta-expire ${exp.class}" title="${t('subscription.expiresIn')}">⏳ ${exp.text}</span>`);
            }
        }
        
        // 2. Fallback: try to extract days from title (various formats)
        if (!metadata.expire && metadata.title) {
            // Support: "383D", "383 days", "expires in 30d", etc.
            const patterns = [
                /(\d+)\s*[ДDд]/i,           // ru/en days: 383D
                /(\d+)\s*days?/i,           // english: 30 days
                /expires?\s*in\s*(\d+)/i,   // expires in 30
            ];
            for (const pattern of patterns) {
                const match = metadata.title.match(pattern);
                if (match) {
                    const days = parseInt(match[1]);
                    if (days > 0 && days < 10000) { // sanitization
                        const expClass = days > 30 ? 'ok' : days > 7 ? 'warning' : 'critical';
                        parts.push(`<span class="sub-meta-expire ${expClass}" title="${t('subscription.expiresIn')}">⏳ ${days} ${t('subscription.days')}</span>`);
                        break;
                    }
                }
            }
        }
        
        // 3. Traffic (standard format: upload + download / total)
        if (metadata.total && metadata.total > 0) {
            const used = (metadata.upload || 0) + (metadata.download || 0);
            const percent = metadata.total > 0 ? Math.round((used / metadata.total) * 100) : 0;
            const usedStr = formatBytes(used);
            const totalStr = formatBytes(metadata.total);
            const trafficClass = percent > 90 ? 'critical' : percent > 70 ? 'warning' : 'ok';
            parts.push(`<span class="sub-meta-traffic ${trafficClass}" title="${t('subscription.trafficUsed')}">📊 ${usedStr} / ${totalStr}</span>`);
        }
        
        // 4. Only download if total not specified
        if (!metadata.total && metadata.download && metadata.download > 0) {
            parts.push(`<span class="sub-meta-traffic ok" title="${t('subscription.downloaded')}">📥 ${formatBytes(metadata.download)}</span>`);
        }
        
        // 5. Update interval (show if non-standard: not 24h and not 0)
        if (metadata.update_interval && metadata.update_interval > 0 && metadata.update_interval !== 24) {
            parts.push(`<span class="sub-meta-info" title="${t('subscription.updateInterval')}">🔄 ${metadata.update_interval}${t('subscription.hours')}</span>`);
        }
        
        if (parts.length === 0) return '';
        return `<div class="subscription-metadata">${parts.join('')}</div>`;
    }

    // Show/hide protocol fields
    function showProtocolFields(protocol) {
        // Hide all
        $$('.protocol-fields').forEach(el => el.classList.add('hidden'));
        
        // Show required
        const fields = $(`#protocol-${protocol}`);
        if (fields) {
            fields.classList.remove('hidden');
        }
        
        // Update required attributes
        $$('.protocol-fields input, .protocol-fields select').forEach(el => {
            el.removeAttribute('required');
        });
        
        // Add required for visible fields
        if (protocol === 'shadowsocks') {
            $('#ss-password')?.setAttribute('required', '');
        } else if (protocol === 'vless') {
            $('#vless-uuid')?.setAttribute('required', '');
        } else if (protocol === 'vmess') {
            $('#vmess-uuid')?.setAttribute('required', '');
        } else if (protocol === 'trojan') {
            $('#trojan-password')?.setAttribute('required', '');
        } else if (protocol === 'wireguard') {
            $('#wg-private-key')?.setAttribute('required', '');
            $('#wg-peer-public-key')?.setAttribute('required', '');
            $('#wg-local-address')?.setAttribute('required', '');
        } else if (protocol === 'amneziawg') {
            $('#awg-private-key')?.setAttribute('required', '');
            $('#awg-peer-public-key')?.setAttribute('required', '');
            $('#awg-local-address')?.setAttribute('required', '');
        } else if (protocol === 'hysteria2') {
            $('#hy2-password')?.setAttribute('required', '');
        }
    }

    function openConfigModal(config = null) {
        const form = elements.configForm;
        const title = $('#config-modal-title');
        
        form.reset();
        
        if (config) {
            title.textContent = t('configModal.titleEdit');
            $('#config-id').value = config.id;
            $('#config-name').value = config.name;
            $('#config-protocol').value = config.protocol || 'shadowsocks';
            $('#config-server').value = config.server;
            $('#config-port').value = config.server_port;
            $('#config-ipv6').checked = config.ipv6_enabled === true;
            // Save initial IPv6 state for tracking changes
            $('#config-ipv6').dataset.initialValue = config.ipv6_enabled === true ? 'true' : 'false';
            // Hide warning banner
            const ipv6Banner = $('#ipv6-warning-banner');
            if (ipv6Banner) ipv6Banner.style.display = 'none';
            
            // Fill protocol fields
            const protocol = config.protocol || 'shadowsocks';
            showProtocolFields(protocol);
            
            if (protocol === 'shadowsocks') {
                $('#ss-password').value = config.password || '';
                $('#ss-method').value = config.method || 'chacha20-ietf-poly1305';
                $('#ss-udp-over-tcp').checked = config.udp_over_tcp === true; // disabled by default
            } else if (protocol === 'vless') {
                $('#vless-uuid').value = config.uuid || '';
                $('#vless-flow').value = config.flow || '';
                $('#vless-tls').checked = config.tls !== false;
                $('#vless-sni').value = config.sni || '';
                $('#vless-security').value = config.security || 'tls';
                $('#vless-public-key').value = config.reality_public_key || '';
                $('#vless-short-id').value = config.reality_short_id || '';
            } else if (protocol === 'vmess') {
                $('#vmess-uuid').value = config.uuid || '';
                $('#vmess-alter-id').value = config.alter_id || 0;
                $('#vmess-security').value = config.security || 'auto';
                $('#vmess-tls').checked = config.tls || false;
                $('#vmess-sni').value = config.sni || '';
            } else if (protocol === 'trojan') {
                $('#trojan-password').value = config.password || '';
                $('#trojan-sni').value = config.sni || '';
                $('#trojan-skip-verify').checked = config.skip_verify || false;
            } else if (protocol === 'wireguard') {
                $('#wg-private-key').value = config.private_key || '';
                $('#wg-peer-public-key').value = config.peer_public_key || '';
                $('#wg-local-address').value = config.local_address || '';
                $('#wg-preshared-key').value = config.preshared_key || '';
                $('#wg-mtu').value = config.mtu || 1420;
            } else if (protocol === 'amneziawg') {
                $('#awg-private-key').value = config.private_key || '';
                $('#awg-peer-public-key').value = config.peer_public_key || '';
                $('#awg-local-address').value = config.local_address || '';
                $('#awg-preshared-key').value = config.preshared_key || '';
                $('#awg-mtu').value = config.mtu || 1280;
                // AmneziaWG obfuscation
                $('#awg-jc').value = config.jc ?? '';
                $('#awg-jmin').value = config.jmin ?? '';
                $('#awg-jmax').value = config.jmax ?? '';
                $('#awg-s1').value = config.s1 ?? '';
                $('#awg-s2').value = config.s2 ?? '';
                $('#awg-h1').value = config.h1 ?? '';
                $('#awg-h2').value = config.h2 ?? '';
                $('#awg-h3').value = config.h3 ?? '';
                $('#awg-h4').value = config.h4 ?? '';
            } else if (protocol === 'hysteria2') {
                $('#hy2-password').value = config.password || '';
                $('#hy2-sni').value = config.sni || '';
                $('#hy2-up-mbps').value = config.up_mbps || 100;
                $('#hy2-down-mbps').value = config.down_mbps || 100;
                $('#hy2-skip-verify').checked = config.skip_verify || false;
                $('#hy2-obfs-password').value = config.obfs_password || '';
            }
        } else {
            title.textContent = t('configModal.addTitle');
            $('#config-id').value = '';
            $('#config-protocol').value = 'shadowsocks';
            $('#config-ipv6').checked = false; // IPv6 disabled by default
            $('#config-ipv6').dataset.initialValue = 'false'; // For new configs
            // Hide warning banner
            const ipv6Banner = $('#ipv6-warning-banner');
            if (ipv6Banner) ipv6Banner.style.display = 'none';
            showProtocolFields('shadowsocks');
        }
        
        showModal(elements.configModal);
    }

    async function saveConfig(formData) {
        const id = formData.get('id');
        const protocol = formData.get('protocol');
        
        // Basic fields
        const data = {
            name: formData.get('name'),
            protocol: protocol,
            server: formData.get('server'),
            server_port: parseInt(formData.get('server_port')),
            ipv6_enabled: $('#config-ipv6').checked
        };
        
        // Fields depending on protocol
        if (protocol === 'shadowsocks') {
            data.password = formData.get('ss_password');
            data.method = formData.get('ss_method');
            data.udp_over_tcp = $('#ss-udp-over-tcp').checked;
        } else if (protocol === 'vless') {
            data.uuid = formData.get('vless_uuid');
            data.flow = formData.get('vless_flow') || '';
            data.tls = formData.get('vless_tls') === 'on';
            data.sni = formData.get('vless_sni') || '';
            data.security = formData.get('vless_security') || 'tls';
            if (data.security === 'reality') {
                data.reality_public_key = formData.get('vless_public_key') || '';
                data.reality_short_id = formData.get('vless_short_id') || '';
            }
        } else if (protocol === 'vmess') {
            data.uuid = formData.get('vmess_uuid');
            data.alter_id = parseInt(formData.get('vmess_alter_id')) || 0;
            data.security = formData.get('vmess_security') || 'auto';
            data.tls = formData.get('vmess_tls') === 'on';
            data.sni = formData.get('vmess_sni') || '';
        } else if (protocol === 'trojan') {
            data.password = formData.get('trojan_password');
            data.sni = formData.get('trojan_sni') || '';
            data.skip_verify = formData.get('trojan_skip_verify') === 'on';
        } else if (protocol === 'wireguard') {
            data.private_key = formData.get('wg_private_key');
            data.peer_public_key = formData.get('wg_peer_public_key');
            data.local_address = formData.get('wg_local_address');
            data.preshared_key = formData.get('wg_preshared_key') || '';
            data.mtu = parseInt(formData.get('wg_mtu')) || 1420;
        } else if (protocol === 'amneziawg') {
            data.private_key = formData.get('awg_private_key');
            data.peer_public_key = formData.get('awg_peer_public_key');
            data.local_address = formData.get('awg_local_address');
            data.preshared_key = formData.get('awg_preshared_key') || '';
            data.mtu = parseInt(formData.get('awg_mtu')) || 1280;
            // AmneziaWG obfuscation
            const jc = formData.get('awg_jc');
            const jmin = formData.get('awg_jmin');
            const jmax = formData.get('awg_jmax');
            const s1 = formData.get('awg_s1');
            const s2 = formData.get('awg_s2');
            const h1 = formData.get('awg_h1');
            const h2 = formData.get('awg_h2');
            const h3 = formData.get('awg_h3');
            const h4 = formData.get('awg_h4');
            if (jc) data.jc = parseInt(jc);
            if (jmin) data.jmin = parseInt(jmin);
            if (jmax) data.jmax = parseInt(jmax);
            if (s1) data.s1 = parseInt(s1);
            if (s2) data.s2 = parseInt(s2);
            if (h1) data.h1 = parseInt(h1);
            if (h2) data.h2 = parseInt(h2);
            if (h3) data.h3 = parseInt(h3);
            if (h4) data.h4 = parseInt(h4);
        } else if (protocol === 'hysteria2') {
            data.password = formData.get('hy2_password');
            data.sni = formData.get('hy2_sni') || '';
            data.up_mbps = parseInt(formData.get('hy2_up_mbps')) || 100;
            data.down_mbps = parseInt(formData.get('hy2_down_mbps')) || 100;
            data.skip_verify = formData.get('hy2_skip_verify') === 'on';
            data.obfs_password = formData.get('hy2_obfs_password') || '';
        }
        
        // Show loader on button
        const submitBtn = elements.configForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="btn-spinner"></span> ${t('configModal.saving')}`;
        
        try {
            if (id) {
                await api(`/vpn.cgi/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(data)
                });
                showToast(t('success.configUpdated'), 'success');
            } else {
                await api('/vpn.cgi', {
                    method: 'POST',
                    body: JSON.stringify(data)
                });
                showToast(t('success.configAdded'), 'success');
                maybeShowDonateAfterConfig();
            }
            
            hideModal(elements.configModal);
            loadConfigs();
            loadStatus();
        } catch (error) {
            showToast(t(error.message) || error.message, 'error');
        } finally {
            // Return button to initial state
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }

    async function editConfig(id) {
        const config = state.configs.find(c => c.id === id);
        if (config) {
            openConfigModal(config);
        }
    }

    let vpnActionInProgress = false;
    let loadingConfigId = null;
    
    // Show loader on config button
    function showConfigLoader(id) {
        loadingConfigId = id;
        const item = document.querySelector(`.config-item[data-id="${id}"]`);
        if (item) {
            const actionBtn = item.querySelector('[data-action="activate"], [data-action="stop"]');
            if (actionBtn) {
                actionBtn.disabled = true;
                actionBtn.innerHTML = `<span class="btn-spinner"></span>`;
            }
        }
    }
    
    // Hide loader
    function hideConfigLoader() {
        loadingConfigId = null;
    }
    
    async function activateConfig(id) {
        if (vpnActionInProgress) {
            showToast(t('info.pleaseWait'), 'warning');
            return;
        }
        
        vpnActionInProgress = true;
        showConfigLoader(id);
        
        try {
            const response = await api(`/vpn.cgi/${id}/activate`, { method: 'POST' });
            
            if (response.success) {
                showToast(t('messages.vpnActivated'), 'success');
                // Update state and UI
                state.activeConfig = id;
                state.vpnRunning = true;
            } else {
                showToast(t(response.error) || t('errors.vpnActivation'), 'error');
            }
        } catch (error) {
            const errorMsg = error.message || t('errors.unknown');
            showToast(`${t('errors.vpnStart')}: ${errorMsg}`, 'error');
        } finally {
            vpnActionInProgress = false;
            hideConfigLoader();
            // Update UI
            await loadStatus();
            renderConfigs();
        }
    }

    async function stopConfig(id) {
        if (vpnActionInProgress) {
            showToast(t('info.pleaseWait'), 'warning');
            return;
        }
        
        vpnActionInProgress = true;
        showConfigLoader(id);
        
        try {
            await api(`/vpn.cgi/active/stop`, { method: 'POST' });
            showToast(t('success.vpnStopped'), 'success');
            state.vpnRunning = false;
        } catch (error) {
            showToast(t(error.message) || error.message, 'error');
        } finally {
            vpnActionInProgress = false;
            hideConfigLoader();
            renderConfigs();
            loadStatus();
        }
    }

    // ============================================
    // Multi-connection mode (several servers at once)
    // ============================================
    // Backend: /multi.cgi. In "multi" mode the Play button of each config is
    // replaced by a checkbox, subscriptions get a "tick all" checkbox, and the
    // failover tile is replaced by #multi-tile. Ticks are collected in a draft
    // and sent only by the Apply button (sing-box restarts, 2–3 s).
    const MULTI_POLL_MS = 20000;
    const MULTI_BLOCKED_PROTOCOLS = ['wireguard', 'amneziawg'];
    const multiState = {
        available: false,   // multi.cgi answered at least once
        mode: 'single',
        limit: 20,
        primary: '',
        members: [],
        subscriptions: [],
        effective: [],
        truncated: 0,
        running: false,
        lastCheck: null,
        draft: null,        // { members:Set, subs:Set, primary } while not applied
        applying: false,
        switching: null,    // mode being switched to
        checking: false,
        pollTimer: null
    };
    
    function multiOn() {
        return multiState.available && multiState.mode === 'multi';
    }
    
    function multiBlocked(config) {
        return MULTI_BLOCKED_PROTOCOLS.includes(String(config.protocol || '').toLowerCase());
    }
    
    // Applied selection as a draft-shaped object
    function multiApplied() {
        return {
            members: new Set(multiState.members.map(String)),
            subs: new Set(multiState.subscriptions.map(String)),
            primary: multiState.primary ? String(multiState.primary) : ''
        };
    }
    
    function multiSelection() {
        return multiState.draft || multiApplied();
    }
    
    function multiEnsureDraft() {
        if (!multiState.draft) multiState.draft = multiApplied();
        return multiState.draft;
    }
    
    // Server ids a selection resolves to, in config-list order
    function multiSelectionIds(sel) {
        return state.configs
            .filter(c => !multiBlocked(c) &&
                (sel.members.has(String(c.id)) || (c.subscription_id && sel.subs.has(String(c.subscription_id)))))
            .map(c => String(c.id));
    }
    
    function multiIsSelected(config) {
        const sel = multiSelection();
        if (multiBlocked(config)) return false;
        return sel.members.has(String(config.id)) ||
            (!!config.subscription_id && sel.subs.has(String(config.subscription_id)));
    }
    
    function multiEffectiveById(id) {
        return multiState.effective.find(e => String(e.id) === String(id)) || null;
    }
    
    function multiSetsEqual(a, b) {
        if (a.size !== b.size) return false;
        for (const v of a) if (!b.has(v)) return false;
        return true;
    }
    
    // Drop the draft when it is back to what is applied
    function multiSettleDraft() {
        const d = multiState.draft;
        if (!d) return;
        const ids = multiSelectionIds(d);
        if (!ids.includes(d.primary)) d.primary = ids[0] || '';
        const a = multiApplied();
        if (multiSetsEqual(d.members, a.members) && multiSetsEqual(d.subs, a.subs) &&
            (d.primary === a.primary || !d.primary)) {
            multiState.draft = null;
        }
    }
    
    function multiRefresh() {
        multiSettleDraft();
        renderMultiUI();
        if (state.configs.length > 0) renderConfigs();
    }
    
    // --- Config list pieces -------------------------------------------------
    
    function renderMultiCheck(config) {
        if (multiState.applying && multiIsSelected(config)) {
            return `<span class="multi-check multi-check-busy"><span class="btn-spinner"></span></span>`;
        }
        if (multiBlocked(config)) {
            return `
                <label class="multi-check disabled" data-action="multi-blocked" title="${escapeHtml(t('multi.wgDisabled'))}">
                    <input type="checkbox" disabled aria-label="${escapeHtml(t('multi.wgDisabled'))}">
                    <span class="multi-check-box"></span>
                </label>`;
        }
        return `
            <label class="multi-check" title="${escapeHtml(t('multi.selectServer'))}">
                <input type="checkbox" data-action="multi-server" data-id="${escapeHtml(String(config.id))}"
                    ${multiIsSelected(config) ? 'checked' : ''} ${multiState.applying ? 'disabled' : ''}
                    aria-label="${escapeHtml(t('multi.selectServer'))}">
                <span class="multi-check-box"></span>
            </label>`;
    }
    
    // Main / traffic / "not in this mode" tags next to the server address
    function renderMultiRowTags(config) {
        if (multiBlocked(config)) {
            return `<span class="multi-wg-note">${t('multi.wgShort')}</span>`;
        }
        const eff = multiEffectiveById(config.id);
        if (!eff || !multiState.running) return '';
        let html = '';
        if (String(eff.id) === String(multiState.primary)) {
            html += `<span class="multi-badge main">${t('multi.statusMain')}</span>`;
        }
        if (eff.carrying) {
            html += `<span class="multi-carry" title="${escapeHtml(t('multi.carryingTitle'))}"><span class="multi-carry-dot"></span>${t('multi.carrying')}</span>`;
        }
        return html;
    }
    
    function renderMultiSubCheck(sub, subConfigs) {
        const eligible = subConfigs.filter(c => !multiBlocked(c));
        const sel = multiSelection();
        const subTicked = sel.subs.has(String(sub.id));
        const some = !subTicked && eligible.some(c => sel.members.has(String(c.id)));
        if (multiState.applying && (subTicked || some)) {
            return `<span class="multi-check multi-check-sub multi-check-busy"><span class="btn-spinner"></span></span>`;
        }
        const disabled = eligible.length === 0 || multiState.applying;
        const title = eligible.length === 0 ? t('multi.wgDisabled') : t('multi.selectSub');
        return `
            <label class="multi-check multi-check-sub ${eligible.length === 0 ? 'disabled' : ''}" data-action="multi-sub"
                title="${escapeHtml(title)}">
                <input type="checkbox" data-action="multi-sub" data-sub-id="${escapeHtml(String(sub.id))}"
                    ${subTicked ? 'checked' : ''} ${some ? 'data-indeterminate="1"' : ''} ${disabled ? 'disabled' : ''}
                    aria-label="${escapeHtml(title)}">
                <span class="multi-check-box"></span>
            </label>`;
    }
    
    // "N selected" in the header, or "fit X of Y" when the limit cut the subscription
    function renderMultiSubNote(sub, subConfigs) {
        const sel = multiSelection();
        const eligible = subConfigs.filter(c => !multiBlocked(c));
        if (!multiState.draft && sel.subs.has(String(sub.id)) && multiState.effective.length > 0) {
            const fit = multiState.effective.filter(e => String(e.subscription_id) === String(sub.id)).length;
            if (fit < eligible.length) {
                return `<span class="multi-sub-note warn" title="${escapeHtml(t('multi.subFitTitle', { limit: multiState.limit }))}">${t('multi.subFit', { fit, n: eligible.length })}</span>`;
            }
        }
        const n = eligible.filter(c => multiIsSelected(c)).length;
        return n > 0 ? `<span class="multi-sub-note">${t('multi.selectedCount', { n })}</span>` : '';
    }
    
    function bindMultiChecks(root) {
        root.querySelectorAll('input[data-indeterminate]').forEach(el => { el.indeterminate = true; });
        root.querySelectorAll('input[data-action="multi-server"]').forEach(el => {
            el.addEventListener('change', () => multiToggleServer(el.dataset.id, el.checked));
        });
        root.querySelectorAll('input[data-action="multi-sub"]').forEach(el => {
            el.addEventListener('change', () => multiToggleSubscription(el.dataset.subId, el.checked));
        });
        // Disabled inputs fire nothing; the label still gets the click (touch has no tooltip)
        root.querySelectorAll('label[data-action="multi-blocked"], label.multi-check-sub.disabled').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showToast(t('multi.wgDisabled'), 'info', 4000);
            });
        });
    }
    
    // --- Selection changes (draft only, applied by the Apply button) --------
    
    function multiToggleServer(id, checked) {
        if (multiState.applying) return;
        id = String(id);
        const config = state.configs.find(c => String(c.id) === id);
        if (!config || multiBlocked(config)) return;
        const d = multiEnsureDraft();
        if (checked) {
            if (!multiSelectionIds(d).includes(id) && multiSelectionIds(d).length >= multiState.limit) {
                showToast(t('multi.limitReached', { limit: multiState.limit }), 'warning');
                multiRefresh();
                return;
            }
            d.members.add(id);
            if (!d.primary) d.primary = id;
        } else {
            d.members.delete(id);
            // Unticking one server of a ticked subscription: keep the rest one by one
            const subId = config.subscription_id ? String(config.subscription_id) : '';
            if (subId && d.subs.has(subId)) {
                d.subs.delete(subId);
                state.configs
                    .filter(c => String(c.subscription_id) === subId && !multiBlocked(c) && String(c.id) !== id)
                    .forEach(c => d.members.add(String(c.id)));
            }
        }
        multiRefresh();
    }
    
    function multiToggleSubscription(subId, checked) {
        if (multiState.applying) return;
        subId = String(subId);
        const d = multiEnsureDraft();
        const subConfigs = state.configs.filter(c => String(c.subscription_id) === subId && !multiBlocked(c));
        const subIds = subConfigs.map(c => String(c.id));
        if (checked) {
            const others = multiSelectionIds(d).filter(id => !subIds.includes(id)).length;
            if (others + subIds.length > multiState.limit) {
                const sub = (state.subscriptions || []).find(s => String(s.id) === subId);
                showToast(t('multi.subTooBig', {
                    name: sub ? sub.name : '',
                    n: subIds.length,
                    free: Math.max(0, multiState.limit - others),
                    limit: multiState.limit
                }), 'warning', 8000);
                multiRefresh();
                return;
            }
            d.subs.add(subId);
            subIds.forEach(id => d.members.delete(id)); // covered by the subscription
            if (!d.primary) d.primary = subIds[0] || '';
        } else {
            d.subs.delete(subId);
            subIds.forEach(id => d.members.delete(id));
        }
        multiRefresh();
    }
    
    // --- API ----------------------------------------------------------------
    
    function multiApplyState(data) {
        if (!data) return;
        multiState.available = true;
        multiState.mode = data.mode === 'multi' ? 'multi' : 'single';
        multiState.limit = parseInt(data.limit, 10) || 20;
        multiState.primary = data.primary ? String(data.primary) : '';
        multiState.members = Array.isArray(data.members) ? data.members.map(String) : [];
        multiState.subscriptions = Array.isArray(data.subscriptions) ? data.subscriptions.map(String) : [];
        multiState.effective = Array.isArray(data.effective) ? data.effective : [];
        multiState.truncated = parseInt(data.truncated, 10) || 0;
        multiState.running = !!data.running;
        multiState.lastCheck = data.last_check || null;
        if (multiState.mode !== 'multi') multiState.draft = null;
        multiSettleDraft();
        scheduleMultiPoll();
        renderMultiUI();
        if (state.configs.length > 0) renderConfigs();
    }
    
    async function loadMultiState() {
        try {
            const res = await api('/multi.cgi');
            if (res && res.success) multiApplyState(res.data);
        } catch (e) {
            // No backend (older install) → the mode switch stays hidden, single mode as before
            if (multiState.available && multiOn()) {
                console.warn('multi state load failed', e);
            }
        }
    }
    
    async function multiPost(path, body) {
        const res = await api('/multi.cgi' + path, { method: 'POST', body: JSON.stringify(body || {}) });
        if (!res || !res.success) throw new Error((res && res.error) || 'errors.unknown');
        return res.data;
    }
    
    function multiErrorText(e) {
        const msg = (e && e.message) || 'errors.unknown';
        return t(msg);
    }
    
    async function multiSwitchMode(mode) {
        if (mode === multiState.mode || multiState.switching || multiState.applying) return;
        if (vpnActionInProgress) {
            showToast(t('info.pleaseWait'), 'warning');
            return;
        }
        vpnActionInProgress = true;
        multiState.switching = mode;
        renderMultiUI();
        try {
            const data = await multiPost('/mode', { mode });
            multiState.draft = null;
            multiApplyState(data);
            showToast(t(mode === 'multi' ? 'multi.switchedMulti' : 'multi.switchedSingle'), 'success');
        } catch (e) {
            showToast(multiErrorText(e), 'error');
        } finally {
            vpnActionInProgress = false;
            multiState.switching = null;
            renderMultiUI();
            await loadStatus();
            if (mode === 'single' && window.VPNFailover?.reload) window.VPNFailover.reload();
        }
    }
    
    async function multiApply() {
        const d = multiState.draft;
        if (!d || multiState.applying) return;
        if (multiSelectionIds(d).length === 0) {
            showToast(t('multi.errors.empty'), 'warning');
            return;
        }
        if (vpnActionInProgress) {
            showToast(t('info.pleaseWait'), 'warning');
            return;
        }
        vpnActionInProgress = true;
        multiState.applying = true;
        renderMultiUI();
        renderConfigs();
        try {
            const body = { members: [...d.members], subscriptions: [...d.subs] };
            if (d.primary) body.primary = d.primary;
            const data = await multiPost('/members', body);
            multiState.draft = null;
            multiState.applying = false;
            multiApplyState(data);
            showToast(t('multi.applied'), 'success');
        } catch (e) {
            showToast(multiErrorText(e), 'error');
        } finally {
            vpnActionInProgress = false;
            multiState.applying = false;
            await loadStatus();
            multiRefresh();
        }
    }
    
    function multiResetDraft() {
        if (multiState.applying) return;
        multiState.draft = null;
        multiRefresh();
    }
    
    async function multiSetPrimary(id) {
        id = String(id);
        // Pending changes: the main server goes with them on Apply
        if (multiState.draft || !multiEffectiveById(id)) {
            multiEnsureDraft().primary = id;
            multiRefresh();
            return;
        }
        if (id === String(multiState.primary)) return;
        const loader = $('#multi-loader');
        if (loader) loader.classList.remove('hidden');
        try {
            multiApplyState(await multiPost('/primary', { id }));
            showToast(t('multi.primarySet'), 'success');
        } catch (e) {
            showToast(multiErrorText(e), 'error');
        } finally {
            if (loader) loader.classList.add('hidden');
        }
    }
    
    async function multiCheckNow() {
        if (multiState.checking || multiState.applying) return;
        multiState.checking = true;
        renderMultiUI();
        try {
            multiApplyState(await multiPost('/check', {}));
            showToast(t('multi.checkDone'), 'success');
        } catch (e) {
            showToast(multiErrorText(e), 'error');
        } finally {
            multiState.checking = false;
            renderMultiUI();
        }
    }
    
    // Poll only in multi mode, only while the VPN tab is on screen
    function scheduleMultiPoll() {
        if (!multiOn()) {
            if (multiState.pollTimer) {
                clearInterval(multiState.pollTimer);
                multiState.pollTimer = null;
            }
            return;
        }
        if (multiState.pollTimer) return;
        multiState.pollTimer = setInterval(() => {
            const vpnTab = document.getElementById('tab-vpn');
            if (!multiOn() || document.hidden || !vpnTab || !vpnTab.classList.contains('active')) return;
            if (multiState.applying || multiState.checking || multiState.switching) return;
            loadMultiState();
        }, MULTI_POLL_MS);
    }
    
    // --- Tile, mode switch, apply bar ----------------------------------------
    
    function multiAge(iso) {
        if (!iso) return t('multi.never');
        const d = new Date(iso);
        if (isNaN(d.getTime())) return t('multi.never');
        const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
        let v;
        if (sec < 60) v = sec + t('time.s');
        else if (sec < 3600) v = Math.floor(sec / 60) + t('time.min');
        else if (sec < 86400) v = Math.floor(sec / 3600) + t('time.h');
        else v = Math.floor(sec / 86400) + t('time.d');
        return `${v} ${t('time.ago')}`;
    }
    
    // Flags in server names ("🇩🇪 Frankfurt") → how many countries are mixed
    function multiCountryCount(names) {
        const flags = new Set();
        names.forEach(n => {
            const m = String(n || '').match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
            if (m) flags.add(m[0]);
        });
        return flags.size;
    }
    
    function renderMultiRow(row) {
        const id = String(row.id);
        const isPrimary = id === String((multiState.draft || multiState).primary);
        const status = row.status || 'unknown';
        const pendingAdd = row.pending === 'add';
        const pendingRemove = row.pending === 'remove';
        const live = !pendingAdd && multiState.running;
        
        let health = 'unknown';
        if (live && status === 'down') health = 'down';
        else if (live && row.delay != null) health = 'ok';
        
        let badge;
        if (pendingAdd) badge = `<span class="multi-badge pending">${t('multi.pendingAdd')}</span>`;
        else if (pendingRemove) badge = `<span class="multi-badge pending">${t('multi.pendingRemove')}</span>`;
        else if (isPrimary) badge = `<span class="multi-badge main">${t('multi.statusMain')}</span>`;
        else badge = `<span class="multi-badge reserve">${t('multi.statusReserve')}</span>`;
        
        let delay = pendingAdd ? '' : '—';
        if (health === 'down') delay = t('multi.statusDown');
        else if (live && row.delay != null) delay = `${row.delay} ${t('multi.ms')}`;
        else if (live && status === 'unknown') delay = t('multi.statusUnknown');
        
        const protocol = PROTOCOLS[row.protocol]?.name || row.protocol || '';
        const sub = row.subscription_id
            ? (state.subscriptions || []).find(s => String(s.id) === String(row.subscription_id))
            : null;
        
        const removeBtn = pendingRemove
            ? `<button class="btn btn-sm btn-icon" data-multi-undo="${escapeHtml(id)}" title="${escapeHtml(t('multi.undoRemove'))}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
               </button>`
            : `<button class="btn btn-sm btn-icon multi-remove" data-multi-remove="${escapeHtml(id)}" title="${escapeHtml(t('multi.remove'))}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
               </button>`;
        
        // One fixed column: "Traffic" in a frame where traffic goes now, otherwise the
        // "Make main" button (none on the main row) — so the delays line up below each other
        let slot = '<span class="multi-slot"></span>';
        if (row.carrying && live) {
            slot = `<span class="multi-slot multi-traffic" title="${escapeHtml(t('multi.carryingTitle'))}"><span class="multi-carry-dot"></span>${t('multi.carrying')}</span>`;
        } else if (!isPrimary) {
            slot = `<button class="btn btn-sm btn-secondary multi-slot multi-make-main" data-multi-primary="${escapeHtml(id)}"
                ${pendingRemove ? 'disabled' : ''}>${t('multi.makePrimary')}</button>`;
        }
        
        return `
            <div class="multi-row ${isPrimary ? 'is-main' : ''} ${row.carrying && live ? 'carrying' : ''} ${pendingAdd ? 'pending-add' : ''} ${pendingRemove ? 'pending-remove' : ''}">
                <span class="multi-dot ${health}"></span>
                <div class="multi-row-main">
                    <div class="multi-row-name">${escapeHtml(row.name || id)}</div>
                    <div class="multi-row-sub">
                        ${protocol ? `<span class="config-protocol">${escapeHtml(protocol)}</span>` : ''}${sub ? escapeHtml(sub.name) : ''}
                    </div>
                </div>
                ${badge}
                ${slot}
                <span class="multi-delay ${health === 'down' ? 'down' : ''}">${delay}</span>
                <div class="multi-row-actions">${removeBtn}</div>
            </div>`;
    }
    
    function renderMultiUI() {
        const sw = $('#multi-mode-switch');
        const tile = $('#multi-tile');
        const failoverTile = $('#failover-tile');
        const bar = $('#multi-apply-bar');
        if (!sw || !tile) return;
        
        sw.classList.toggle('hidden', !multiState.available);
        if (!multiState.available) return;
        
        const on = multiOn();
        sw.querySelectorAll('[data-multi-mode]').forEach(btn => {
            const m = btn.dataset.multiMode;
            const active = m === multiState.mode;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            btn.disabled = !!multiState.switching || multiState.applying;
            const spin = btn.querySelector('.multi-mode-spinner');
            if (spin) spin.classList.toggle('hidden', multiState.switching !== m);
        });
        
        if (failoverTile) failoverTile.classList.toggle('hidden', on);
        tile.classList.toggle('hidden', !on);
        if (bar) bar.classList.toggle('hidden', !on || !multiState.draft);
        if (!on) return;
        
        // Rows: what runs now, plus what the draft adds or removes
        const draft = multiState.draft;
        const draftIds = draft ? multiSelectionIds(draft) : null;
        const appliedIds = multiSelectionIds(multiApplied());
        const rows = multiState.effective.map(e => ({
            ...e,
            pending: draftIds && !draftIds.includes(String(e.id)) ? 'remove' : null
        }));
        if (draftIds) {
            draftIds.forEach(id => {
                if (appliedIds.includes(id) || multiEffectiveById(id)) return;
                const c = state.configs.find(x => String(x.id) === id);
                if (c) rows.push({ id, name: c.name, protocol: c.protocol, subscription_id: c.subscription_id || '', status: 'unknown', delay: null, carrying: false, pending: 'add' });
            });
        }
        
        const count = draftIds ? draftIds.length : multiState.effective.length;
        const counter = $('#multi-counter');
        if (counter) {
            counter.textContent = t('multi.counter', { n: count, limit: multiState.limit });
            counter.classList.toggle('full', count >= multiState.limit);
        }
        
        const list = $('#multi-list');
        if (list) {
            // The main server always heads the list
            const mainId = String((multiState.draft || multiState).primary);
            const ordered = [...rows].sort((a, b) => (String(b.id) === mainId) - (String(a.id) === mainId));
            list.innerHTML = ordered.length
                ? ordered.map(renderMultiRow).join('')
                : `<div class="multi-empty">${t('multi.empty')}</div>`;
            list.querySelectorAll('[data-multi-primary]').forEach(b =>
                b.addEventListener('click', () => multiSetPrimary(b.dataset.multiPrimary)));
            list.querySelectorAll('[data-multi-remove]').forEach(b =>
                b.addEventListener('click', () => multiToggleServer(b.dataset.multiRemove, false)));
            list.querySelectorAll('[data-multi-undo]').forEach(b =>
                b.addEventListener('click', () => multiToggleServer(b.dataset.multiUndo, true)));
        }
        
        const checkBtn = $('#multi-check-btn');
        if (checkBtn) {
            checkBtn.disabled = multiState.checking || multiState.applying || !multiState.effective.length;
            checkBtn.classList.toggle('btn-loading', multiState.checking);
            checkBtn.innerHTML = multiState.checking
                ? `<span class="btn-spinner"></span> ${t('multi.checking')}`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> <span>${t('multi.checkNow')}</span>`;
        }
        
        const info = $('#multi-info');
        if (info) {
            const parts = [`<span class="auto-update-last">${t('multi.lastCheck')}: ${multiAge(multiState.lastCheck)}</span>`];
            if (multiState.truncated > 0 && !draft) {
                parts.push(`<span class="multi-warn">${t('multi.truncated', { n: multiState.truncated, limit: multiState.limit })}</span>`);
            }
            if (multiCountryCount(rows.filter(r => r.pending !== 'remove').map(r => r.name)) > 1) {
                parts.push(`<span class="multi-hint">${t('multi.countryHint')}</span>`);
            }
            info.innerHTML = parts.join('<span class="auto-update-separator">•</span>');
        }
        
        if (bar && draft) {
            const n = draftIds.length;
            const text = $('#multi-apply-count');
            if (text) {
                text.textContent = n > 0
                    ? t('multi.pending', { n, limit: multiState.limit })
                    : t('multi.pendingEmpty');
            }
            const applyBtn = $('#multi-apply-btn');
            if (applyBtn) {
                applyBtn.disabled = multiState.applying || n === 0;
                applyBtn.classList.toggle('btn-loading', multiState.applying);
                applyBtn.innerHTML = multiState.applying
                    ? `<span class="btn-spinner"></span> ${t('multi.applying')}`
                    : t('multi.apply');
            }
            const resetBtn = $('#multi-reset-btn');
            if (resetBtn) resetBtn.disabled = multiState.applying;
        }
    }
    
    function initMultiMode() {
        $$('#multi-mode-switch [data-multi-mode]').forEach(btn => {
            btn.addEventListener('click', () => multiSwitchMode(btn.dataset.multiMode));
        });
        $('#multi-check-btn')?.addEventListener('click', multiCheckNow);
        $('#multi-apply-btn')?.addEventListener('click', multiApply);
        $('#multi-reset-btn')?.addEventListener('click', multiResetDraft);
    }

    async function checkVpnIp() {
        try {
            showToast(t('info.checkingIp'), 'info');
            const response = await api(`/vpn.cgi/active/check-ip`, { method: 'POST' });
            
            if (response.data) {
                const { current_ip, vpn_working, vpn_server } = response.data;
                
                if (vpn_working) {
                    showToast(`${t('vpnCheck.active')}! IP: ${current_ip}`, 'success');
                } else {
                    showToast(`${t('vpnCheck.inactive')}. IP: ${current_ip}`, 'warning');
                }
                
                // Show modal with details
                showVpnCheckResult(current_ip, vpn_working, vpn_server);
            }
        } catch (error) {
            showToast(t(error.message) || error.message, 'error');
        }
    }
    
    // ============================================
    // Network Settings (IPv6, Port)
    // ============================================
    
    async function loadNetworkStatus() {
        try {
            const response = await api('/network.cgi?action=all_status');
            if (response.data) {
                updateIPv6Button(response.data.ipv6);
                updatePortButton(response.data.port_8388);
            }
        } catch (error) {
            console.warn('Failed to load network status:', error);
        }
    }
    
    function updateIPv6Button(status) {
        const btn = $('#ipv6-toggle-btn');
        const text = $('#ipv6-btn-text');
        if (!btn || !text) return;
        
        if (status === 'enabled') {
            text.textContent = t('ipv6.on');
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-warning');
        } else {
            text.textContent = t('ipv6.off');
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-secondary');
        }
        btn.dataset.status = status;
    }
    
    function updatePortButton(status) {
        const btn = $('#open-port-btn');
        const text = $('#port-btn-text');
        if (!btn || !text) return;
        
        if (status === 'open') {
            text.textContent = t('port8388.open');
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-success');
        } else {
            text.textContent = t('port8388.openBtn');
            btn.classList.remove('btn-success');
            btn.classList.add('btn-primary');
        }
        btn.dataset.status = status;
    }
    
    async function toggleIPv6() {
        const btn = $('#ipv6-toggle-btn');
        const currentStatus = btn?.dataset.status || 'unknown';
        
        if (currentStatus === 'enabled') {
            // Disable — simple confirmation
            if (!confirm(t('ipv6.confirmDisable'))) {
                return;
            }
            
            try {
                showToast(t('info.disablingIpv6'), 'info');
                const response = await api('/network.cgi', {
                    method: 'POST',
                    body: JSON.stringify({ action: 'disable_ipv6' })
                });
                
                if (response.data) {
                    updateIPv6Button('disabled');
                    showToast(t('ipv6.disabled'), 'success');
                    if (response.data.log) {
                        console.log('IPv6 disable log:', response.data.log);
                    }
                }
            } catch (error) {
                showToast(t('errors.withMessage', {message: error.message}), 'error');
            }
        } else {
            // Enable — VPN warning
            if (!confirm(t('ipv6.confirmEnable'))) {
                return;
            }
            
            try {
                showToast(t('info.enablingIpv6'), 'info');
                const response = await api('/network.cgi', {
                    method: 'POST',
                    body: JSON.stringify({ action: 'enable_ipv6' })
                });
                
                if (response.data) {
                    updateIPv6Button('enabled');
                    showToast(t('ipv6.enabled'), 'warning');
                    if (response.data.log) {
                        console.log('IPv6 enable log:', response.data.log);
                    }
                }
            } catch (error) {
                showToast(t('errors.withMessage', {message: error.message}), 'error');
            }
        }
    }
    
    async function openPort8388() {
        const btn = $('#open-port-btn');
        const currentStatus = btn?.dataset.status || 'closed';
        
        if (currentStatus === 'open') {
            // Port already open — offer to close
            if (!confirm(t('port8388.confirmClose'))) {
                return;
            }
            
            try {
                showToast(t('info.closingPort'), 'info');
                const response = await api('/network.cgi', {
                    method: 'POST',
                    body: JSON.stringify({ action: 'close_port' })
                });
                
                if (response.data) {
                    updatePortButton(response.data.status);
                    showToast(t('success.portClosed'), 'success');
                }
            } catch (error) {
                showToast(t('errors.withMessage', {message: error.message}), 'error');
            }
        } else {
            // Opening port
            if (!confirm(t('port8388.confirmOpen'))) {
                return;
            }
            
            try {
                showToast(t('info.openingPort'), 'info');
                const response = await api('/network.cgi', {
                    method: 'POST',
                    body: JSON.stringify({ action: 'open_port' })
                });
                
                if (response.data) {
                    updatePortButton(response.data.status);
                    showToast(t('success.portOpened'), 'success');
                }
            } catch (error) {
                showToast(t('errors.withMessage', {message: error.message}), 'error');
            }
        }
    }
    
    async function startVpn() {
        // Try to use last active configuration from state
        const lastConfig = state.lastActiveConfig || state.activeConfig;
        
        if (!lastConfig) {
            // If no last config in state, try to get it from backend
            try {
                showToast(t('info.checkingConfig'), 'info');
                const statusData = await api('/status.cgi');
                const backendLastConfig = statusData.data?.vpn?.active_config;
                
                if (!backendLastConfig) {
                    showToast(t('errors.noLastActiveConfig'), 'warning');
                    return;
                }
                
                await activateConfig(backendLastConfig);
            } catch (error) {
                showToast(t('errors.noLastActiveConfig'), 'warning');
            }
            return;
        }
        
        // Show loader and activate the last active configuration
        showToast(t('info.startingVpn'), 'info');
        try {
            await activateConfig(lastConfig);
        } catch (error) {
            showToast(t('errors.vpnStart') + ': ' + (error.message || t('errors.unknown')), 'error');
        }
    }
    
    async function stopVpn() {
        $('#confirm-title').textContent = t('stopVpn.title');
        $('#confirm-message').textContent = t('stopVpn.message');
        
        showModal(elements.confirmModal);
        
        const okBtn = $('#confirm-ok');
        const cancelBtn = $('#confirm-cancel');
        
        // Change button style to "danger"
        okBtn.textContent = t('vpn.stop');
        okBtn.classList.add('btn-danger');
        okBtn.classList.remove('btn-primary');
        
        const handler = async () => {
            okBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            okBtn.classList.remove('btn-danger');
            okBtn.classList.add('btn-primary');
            okBtn.textContent = 'OK';
            
            // Hide modal immediately
            hideModal(elements.confirmModal);
            
            // Show loading toast
            showToast(t('info.stoppingVpn'), 'info');
            
            try {
                const response = await api(`/vpn.cgi/active/stop`, { method: 'POST' });
                
                if (response.success) {
                    showToast(t('success.vpnStopped'), 'success');
                    state.vpnRunning = false;
                    state.activeConfig = null;
                    await loadStatus();
                    loadConfigs();
                } else {
                    showToast(t(response.error) || t('errors.vpnStop'), 'error');
                }
            } catch (error) {
                showToast(t(error.message) || error.message, 'error');
            }
        };
        
        const cancelHandler = () => {
            cancelBtn.removeEventListener('click', cancelHandler);
            okBtn.removeEventListener('click', handler);
            okBtn.classList.remove('btn-danger');
            okBtn.classList.add('btn-primary');
            okBtn.textContent = 'OK';
            hideModal(elements.confirmModal);
        };
        
        okBtn.addEventListener('click', handler);
        cancelBtn.addEventListener('click', cancelHandler);
    }
    
    function showVpnCheckResult(ip, working, server) {
        const status = working ? 
            `<span style="color: var(--success-color)">✓ ${t('vpnCheck.active')}</span>` :
            `<span style="color: var(--warning-color)">✗ ${t('vpnCheck.inactive')}</span>`;
        
        $('#confirm-title').textContent = t('vpnCheck.title');
        $('#confirm-message').innerHTML = `
            <div style="text-align: left; line-height: 1.8;">
                <p><strong>${t('vpnCheck.currentIp')}:</strong> ${ip}</p>
                <p><strong>${t('vpnCheck.vpnServer')}:</strong> ${server || t('vpnCheck.notConfigured')}</p>
                <p><strong>${t('vpnCheck.status')}:</strong> ${status}</p>
            </div>
        `;
        
        showModal(elements.confirmModal);
        
        // Hide OK button, keep only Cancel as "Close"
        const okBtn = $('#confirm-ok');
        const cancelBtn = $('#confirm-cancel');
        okBtn.style.display = 'none';
        cancelBtn.textContent = t('confirm.close');
        
        const handler = () => {
            cancelBtn.removeEventListener('click', handler);
            okBtn.style.display = '';
            cancelBtn.textContent = t('dialog.cancel');
            hideModal(elements.confirmModal);
        };
        cancelBtn.addEventListener('click', handler);
    }

    // ============================================
    // Import from URL
    // ============================================
    
    let importedConfigData = null;
    let currentImportTab = 'url';
    
    function openImportModal() {
        const modal = $('#import-modal');
        const urlInput = $('#import-url');
        const fileContent = $('#import-file-content');
        const preview = $('#import-preview');
        const error = $('#import-error');
        const saveBtn = $('#import-save-btn');
        const fileName = $('#file-name');
        
        // Clear URL tab
        urlInput.value = '';
        if (fileContent) fileContent.value = '';
        preview.classList.add('hidden');
        error.classList.add('hidden');
        if (fileName) fileName.classList.add('hidden');
        saveBtn.disabled = true;
        importedConfigData = null;
        currentImportTab = 'url';
        
        // Clear subscription tab
        const subUrl = $('#subscription-url');
        const subName = $('#subscription-name');
        const subPreview = $('#subscription-preview');
        const subSaveBtn = $('#subscription-save-btn');
        if (subUrl) subUrl.value = '';
        if (subName) subName.value = '';
        if (subPreview) subPreview.classList.add('hidden');
        if (subSaveBtn) subSaveBtn.disabled = true;
        subscriptionPreviewData = null;
        
        // Reset tabs
        $$('.import-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.importTab === 'url');
        });
        $('#import-url-section')?.classList.remove('hidden');
        $('#import-file-section')?.classList.add('hidden');
        $('#import-subscription-section')?.classList.add('hidden');
        
        showModal(modal);
        urlInput.focus();
    }
    
    function switchImportTab(tabName) {
        currentImportTab = tabName;
        
        $$('.import-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.importTab === tabName);
        });
        
        const urlSection = $('#import-url-section');
        const fileSection = $('#import-file-section');
        const subscriptionSection = $('#import-subscription-section');
        
        // Hide all sections
        urlSection?.classList.add('hidden');
        fileSection?.classList.add('hidden');
        subscriptionSection?.classList.add('hidden');
        
        // Show/hide appropriate buttons
        const parseBtn = $('#import-parse-btn');
        const saveBtn = $('#import-save-btn');
        const subPreviewBtn = $('#subscription-preview-btn');
        const subSaveBtn = $('#subscription-save-btn');
        
        if (tabName === 'subscription') {
            subscriptionSection?.classList.remove('hidden');
            parseBtn.style.display = 'none';
            saveBtn.style.display = 'none';
            subPreviewBtn.style.display = '';
            subSaveBtn.style.display = '';
        } else {
        if (tabName === 'url') {
            urlSection?.classList.remove('hidden');
        } else {
            fileSection?.classList.remove('hidden');
            }
            parseBtn.style.display = '';
            saveBtn.style.display = '';
            subPreviewBtn.style.display = 'none';
            subSaveBtn.style.display = 'none';
        }
        
        // Reset preview
        $('#import-preview')?.classList.add('hidden');
        $('#import-error')?.classList.add('hidden');
        $('#subscription-preview')?.classList.add('hidden');
        $('#import-save-btn').disabled = true;
        $('#subscription-save-btn').disabled = true;
        importedConfigData = null;
    }
    
    function showImportPreview(data) {
        const preview = $('#import-preview');
        const previewContent = $('#import-preview-content');
        const saveBtn = $('#import-save-btn');
        
        importedConfigData = data;
        
        // Show preview
        let html = '';
        const labels = {
            protocol: t('import.label.protocol'),
            name: t('import.label.name'),
            server: t('import.label.server'),
            server_port: t('import.label.port'),
            method: t('import.label.method'),
            uuid: 'UUID',
            flow: 'Flow',
            security: t('import.label.security'),
            sni: 'SNI',
            private_key: 'Private Key',
            peer_public_key: 'Peer Public Key',
            local_address: t('import.label.address'),
            mtu: 'MTU'
        };
        
        for (const [key, value] of Object.entries(data)) {
            if (value && labels[key]) {
                let displayValue = value;
                // Mask keys
                if (key === 'private_key' || key === 'peer_public_key') {
                    displayValue = value.substring(0, 8) + '...' + value.substring(value.length - 4);
                }
                html += `<div class="import-preview-item">
                    <span class="import-preview-label">${labels[key]}</span>
                    <span class="import-preview-value">${displayValue}</span>
                </div>`;
            }
        }
        
        previewContent.innerHTML = html;
        preview.classList.remove('hidden');
        saveBtn.disabled = false;
    }
    
    async function parseImportUrl() {
        const error = $('#import-error');
        const saveBtn = $('#import-save-btn');
        const parseBtn = $('#import-parse-btn');
        let dataToSend = {};
        let customName = '';
        
        if (currentImportTab === 'url') {
            const url = $('#import-url').value.trim();
            if (!url) {
                error.textContent = t('import.enterUrl');
                error.classList.remove('hidden');
                return;
            }
            dataToSend = { url };
        } else {
            // File/conf tab
            const fileContent = $('#import-file-content')?.value.trim();
            if (!fileContent) {
                error.textContent = t('import.pasteConfig');
                error.classList.remove('hidden');
                return;
            }
            dataToSend = { url: fileContent };
            customName = $('#import-file-name')?.value?.trim() || '';
        }
        
        error.classList.add('hidden');
        
        const originalBtnText = parseBtn.innerHTML;
        parseBtn.disabled = true;
        parseBtn.innerHTML = `<span class="btn-spinner"></span> ${t('import.validate')}`;
        
        try {
            const response = await api('/vpn.cgi/import', {
                method: 'POST',
                body: JSON.stringify(dataToSend)
            });
            
            if (response.data && response.data.error) {
                // Parser returned error (e.g. unsupported plugin)
                throw new Error(response.data.error);
            } else if (response.data && response.data.protocol) {
                // XHTTP is supported in sing-box Extended - block removed
                
                // AmneziaWG check (disabled due to bug in sing-box-extended)
                if (response.data.protocol === 'amneziawg' && !CONFIG.AMNEZIAWG_ENABLED) {
                    error.textContent = t('import.awgNotSupported');
                    error.classList.remove('hidden');
                    $('#import-preview')?.classList.add('hidden');
                    saveBtn.disabled = true;
                    return;
                }
                
                // If user entered a name — use it
                if (customName) {
                    response.data.name = customName;
                }
                showImportPreview(response.data);
                showToast(t('success.configParsed'), 'success');
            } else {
                throw new Error(t('import.parseError'));
            }
        } catch (err) {
            error.textContent = err.message || t('import.parsingError');
            error.classList.remove('hidden');
            $('#import-preview')?.classList.add('hidden');
            saveBtn.disabled = true;
        } finally {
            parseBtn.disabled = false;
            parseBtn.innerHTML = originalBtnText;
        }
    }
    
    async function saveImportedConfig() {
        if (!importedConfigData) return;
        
        const saveBtn = $('#import-save-btn');
        const originalBtnText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<span class="btn-spinner"></span> ${t('vpn.import')}`;
        
        try {
            await api('/vpn.cgi', {
                method: 'POST',
                body: JSON.stringify(importedConfigData)
            });
            
            showToast(t('success.configImported'), 'success');
            hideModal($('#import-modal'));
            loadConfigs();
            maybeShowDonateAfterConfig();
        } catch (err) {
            showToast(t(err.message) || t('errors.saving'), 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnText;
        }
    }

    // ============================================
    // Subscriptions
    // ============================================
    
    let subscriptionPreviewData = null;
    
    async function previewSubscription() {
        const url = $('#subscription-url')?.value?.trim();
        const error = $('#import-error');
        const previewSection = $('#subscription-preview');
        const serverCount = $('#subscription-server-count');
        const serverList = $('#subscription-server-list');
        const saveBtn = $('#subscription-save-btn');
        const previewBtn = $('#subscription-preview-btn');
        
        error?.classList.add('hidden');
        previewSection?.classList.add('hidden');
        saveBtn.disabled = true;
        subscriptionPreviewData = null;
        
        if (!url) {
            error.textContent = t('subscription.enterUrl');
            error?.classList.remove('hidden');
            return;
        }
        
        // Show loader on button
        const originalBtnText = previewBtn.innerHTML;
        previewBtn.disabled = true;
        previewBtn.innerHTML = `<span class="btn-spinner"></span> ${t('subscription.loading')}`;
        
        try {
            const result = await api('/subscriptions.cgi/preview', {
                method: 'POST',
                body: JSON.stringify({ url })
            });
            
            const data = result.data;
            
            if (!data.servers || data.count === 0) {
                error.textContent = t('subscription.noServersFound');
                error?.classList.remove('hidden');
                return;
            }
            
            subscriptionPreviewData = data.servers;
            serverCount.textContent = data.count;
            
            // Render server list
            let html = '';
            data.servers.slice(0, 10).forEach(server => {
                let proto = server.protocol || '';
                if (server.transport_type && server.transport_type !== 'none' && server.transport_type !== '') {
                    proto += '+' + server.transport_type;
                }
                html += `<div class="subscription-server-item">
                    <span class="server-protocol">${proto}</span>
                    <span class="server-name">${server.name || server.server}</span>
                    <span class="server-address">${server.server}:${server.server_port}</span>
                </div>`;
            });
            
            if (data.count > 10) {
                html += `<div class="subscription-server-more">${t('subscription.andMore').replace('{count}', data.count - 10)}</div>`;
            }
            
            serverList.innerHTML = html;
            previewSection?.classList.remove('hidden');
            saveBtn.disabled = false;
            
        } catch (err) {
            error.textContent = err.message || t('errors.loading');
            error?.classList.remove('hidden');
        } finally {
            // Restore button
            previewBtn.disabled = false;
            previewBtn.innerHTML = originalBtnText;
        }
    }
    
    async function saveSubscription() {
        const url = $('#subscription-url')?.value?.trim();
        const name = $('#subscription-name')?.value?.trim();
        const autoUpdate = $('#subscription-auto-update')?.checked ?? true;
        const updateInterval = parseInt($('#subscription-interval')?.value) || 3;
        
        if (!url || !subscriptionPreviewData) {
            showToast(t('errors.checkSubscription'), 'error');
            return;
        }
        
        const saveBtn = $('#subscription-save-btn');
        const originalBtnText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<span class="btn-spinner"></span> ${t('import.addSubscription')}`;
        
        try {
            const result = await api('/subscriptions.cgi', {
                method: 'POST',
                body: JSON.stringify({
                    url,
                    name,
                    auto_update: autoUpdate,
                    update_interval: updateInterval
                })
            });
            
            const data = result.data;
            showToast(t('subscription.addedToast').replace('{count}', data.server_count), 'success');
            hideModal($('#import-modal'));
            loadConfigs();
            loadSubscriptions();
            maybeShowDonateAfterConfig();
            
        } catch (err) {
            showToast(t(err.message) || t('errors.subscriptionSave'), 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnText;
        }
    }
    
    async function loadSubscriptions() {
        try {
            const result = await api('/subscriptions.cgi/list');
            state.subscriptions = result.data?.subscriptions || [];
        } catch (err) {
            state.subscriptions = [];
        }
    }
    
    async function refreshSubscription(subId) {
        const group = $(`.subscription-group[data-subscription-id="${subId}"]`);
        const refreshBtn = group?.querySelector('[data-action="refresh"]');
        if (refreshBtn) refreshBtn.classList.add('spinning');
        
        try {
            showToast(t('info.updatingSubscription'), 'info');
            const result = await api(`/subscriptions.cgi/${subId}/refresh`, {
                method: 'POST'
            });
            const data = result.data;
            showToast(t('subscription.updatedToast').replace('{count}', data.server_count), 'success');
            loadConfigs();
            loadSubscriptions();
        } catch (err) {
            showToast(t(err.message) || t('errors.subscriptionUpdate'), 'error');
        } finally {
            if (refreshBtn) refreshBtn.classList.remove('spinning');
        }
    }
    
    async function deleteSubscription(subId) {
        const sub = state.subscriptions?.find(s => s.id === subId);
        
        $('#confirm-title').textContent = t('subscription.deleteTitle');
        $('#confirm-message').textContent = t('subscription.deleteMessage').replace('{name}', sub?.name || subId);
        
        const okBtn = $('#confirm-ok');
        const cancelBtn = $('#confirm-cancel');
        
        okBtn.textContent = t('vpn.delete');
        cancelBtn.textContent = t('dialog.cancel');
        
        showModal(elements.confirmModal);
        
        const cleanup = () => {
            okBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            hideModal(elements.confirmModal);
        };
        
        const handler = async () => {
            try {
                await api(`/subscriptions.cgi/${subId}`, { method: 'DELETE' });
                showToast(t('success.subscriptionDeleted'), 'success');
                cleanup();
                loadConfigs();
                loadSubscriptions();
            } catch (err) {
                showToast(t(err.message) || t('errors.deleting'), 'error');
                cleanup();
            }
        };
        
        const cancelHandler = () => {
            cleanup();
        };
        
        okBtn.addEventListener('click', handler);
        cancelBtn.addEventListener('click', cancelHandler);
    }

    async function deleteConfig(id) {
        const config = state.configs.find(c => c.id === id);
        
        $('#confirm-title').textContent = t('config.deleteTitle');
        $('#confirm-message').textContent = t('config.deleteMessage').replace('{name}', config?.name || id);
        
        const okBtn = $('#confirm-ok');
        const cancelBtn = $('#confirm-cancel');
        
        okBtn.textContent = t('vpn.delete');
        cancelBtn.textContent = t('dialog.cancel');
        
        showModal(elements.confirmModal);
        
        const handler = async () => {
            okBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            
            try {
                await api(`/vpn.cgi/${id}`, { method: 'DELETE' });
                showToast(t('success.configDeleted'), 'success');
                hideModal(elements.confirmModal);
                loadConfigs();
                loadStatus();
            } catch (error) {
                showToast(t(error.message) || error.message, 'error');
            }
        };
        
        const cancelHandler = () => {
            okBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            hideModal(elements.confirmModal);
        };
        
        okBtn.addEventListener('click', handler);
        cancelBtn.addEventListener('click', cancelHandler);
    }

    // ============================================
    // List sets (B1): lists for Direct primary / VPN primary
    // ============================================

    // Add listset parameter for the Russia set; World sends nothing extra
    function withListSet(url, listSet = state.listSet) {
        if (listSet !== 'russia') return url;
        return url + (url.includes('?') ? '&' : '?') + 'listset=russia';
    }

    function otherListMode(mode) {
        return mode === 'split' ? 'vpnprimary' : 'split';
    }

    function otherListSet(listSet) {
        return listSet === 'world' ? 'russia' : 'world';
    }

    function listModeName(mode) {
        return t(mode === 'split' ? 'lists.modeSplit' : 'lists.modeVpnPrimary');
    }

    // Mode tabs, rule, list selector and networks on both tabs
    function updateListModeUI() {
        const mode = state.listMode;
        const other = otherListMode(mode);
        const ruleKey = mode === 'split' ? 'lists.ruleSplit' : 'lists.ruleVpnPrimary';
        const modeKey = mode === 'split' ? 'Split' : 'VpnPrimary';
        ['domains', 'subnets'].forEach(tab => {
            $$(`#tab-${tab} .list-mode-tab`).forEach(btn => {
                const active = btn.dataset.listMode === mode;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            const panel = $(`#list-mode-panel-${tab}`);
            if (panel) panel.dataset.mode = mode;
            const rule = $(`#list-mode-rule-${tab}`);
            if (rule) rule.innerHTML = t(tab === 'subnets' ? `${ruleKey}Subnets` : ruleKey);
            // Sub-tab descriptions follow the mode: in VPN primary the list goes direct
            ['tcpudp', 'udponly'].forEach(type => {
                const desc = $(`#${tab}-desc-${type}`);
                const typeKey = type === 'tcpudp' ? 'TcpUdp' : 'UdpOnly';
                if (desc) desc.textContent = t(`lists.desc${modeKey}${typeKey}${tab === 'subnets' ? 'Subnets' : ''}`);
            });
            const select = $(`#list-binding-select-${tab}`);
            if (select) select.value = listBinding[mode];
            const hint = $(`#list-other-hint-${tab}`);
            if (hint) hint.textContent = t('lists.otherModeHint', { mode: listModeName(other), list: LIST_SET_NAMES[listBinding[other]] });
        });
        renderListModeSegments();
    }

    // Networks and their modes from segments.cgi (null: not loaded)
    let listModeSegments = null;

    async function loadListModeSegments() {
        try {
            const response = await api('/segments.cgi');
            // Same order and names as the routing tile on the main page
            const segments = [...(response.segments || [])].sort((a, b) => {
                if (a.bridge === 'br0') return -1;
                if (b.bridge === 'br0') return 1;
                return a.index - b.index;
            }).map(seg => ({ name: seg.description || seg.name || seg.bridge, policy: seg.policy }));
            if (response.vpn_server) {
                segments.push({ isVpnServer: true, policy: response.vpn_server.policy || 'split' });
            }
            listModeSegments = segments;
        } catch (error) {
            console.error('Failed to load segments for lists:', error);
            listModeSegments = null;
        }
        renderListModeSegments();
    }

    function renderListModeSegments() {
        ['domains', 'subnets'].forEach(tab => {
            const box = $(`#list-mode-nets-${tab}`);
            if (!box) return;
            if (!listModeSegments) {
                box.textContent = '—';
                return;
            }
            const names = listModeSegments
                .filter(seg => seg.policy === state.listMode)
                .map(seg => seg.isVpnServer ? t('tab.server') : seg.name);
            box.innerHTML = names.length
                ? names.map(name => `<span class="list-mode-chip">${escapeHtml(name)}</span>`).join('')
                : `<span class="list-mode-empty">${t('lists.noSegmentsInMode')}</span>`;
        });
    }

    function listsHaveUnsavedChanges() {
        if (state.currentTab === 'domains') {
            return (elements.domainsEditorTcpUdp && elements.domainsEditorTcpUdp.value !== state.domainsTcpUdpOriginal) ||
                (elements.domainsEditorUdpOnly && elements.domainsEditorUdpOnly.value !== state.domainsUdpOnlyOriginal);
        }
        if (state.currentTab === 'subnets') {
            return (elements.subnetsEditorTcpUdp && elements.subnetsEditorTcpUdp.value !== state.subnetsTcpUdpOriginal) ||
                (elements.subnetsEditorUdpOnly && elements.subnetsEditorUdpOnly.value !== state.subnetsUdpOnlyOriginal);
        }
        return false;
    }

    // Point the editors at a list set; reload the open tab when the set changes
    function showListSet(listSet) {
        const changed = listSet !== state.listSet;
        state.listSet = listSet;
        updateListModeUI();
        if (!changed) return;
        hideListOverlapWarnings();

        // The other tab reloads its lists when opened
        if (state.currentTab === 'domains') loadDomains();
        else if (state.currentTab === 'subnets') loadSubnets();
    }

    function switchListMode(mode) {
        if (!LIST_MODES.includes(mode) || mode === state.listMode) return;
        const listSet = listBinding[mode];
        if (listSet !== state.listSet && listsHaveUnsavedChanges() && !confirm(t('lists.unsavedSwitchConfirm'))) return;

        state.listMode = mode;
        try { localStorage.setItem(LIST_MODE_STORAGE_KEY, mode); } catch (_) {}
        showListSet(listSet);
    }

    // Opening Domains or Subnets: the binding decides which set is loaded
    async function openListsTab(tab) {
        hideListOverlapWarnings();
        loadListModeSegments();
        await loadListBinding();
        if (state.currentTab !== tab) return;

        state.listSet = listBinding[state.listMode];
        updateListModeUI();
        if (tab === 'domains') loadDomains();
        else loadSubnets();
    }

    async function loadListBinding() {
        try {
            const data = await api('/settings.cgi');
            const b = data.success && data.data ? data.data.list_binding : null;
            if (b && LIST_SETS.includes(b.split) && LIST_SETS.includes(b.vpnprimary)) {
                listBinding = { split: b.split, vpnprimary: b.vpnprimary };
            }
        } catch (error) {
            console.error('Failed to load list binding:', error);
        }
    }

    // Save a new binding; the list on screen follows the selected mode
    async function saveListBinding(next) {
        if (next[state.listMode] !== state.listSet && listsHaveUnsavedChanges() && !confirm(t('lists.unsavedSwitchConfirm'))) {
            updateListModeUI(); // put the select back
            return;
        }
        const controls = $$('.list-binding-select, .list-swap-btn');
        controls.forEach(c => { c.disabled = true; });

        try {
            const data = await api('/settings.cgi/list-binding', {
                method: 'POST',
                body: JSON.stringify(next)
            });
            if (data.success === false) {
                throw new Error(data.error || 'errors.listBindingFailed');
            }
            listBinding = next;
            showToast(t('success.listBindingSaved'), 'success');
        } catch (error) {
            showToast(t(error.message) || t('errors.listBindingFailed'), 'error');
        } finally {
            controls.forEach(c => { c.disabled = false; });
            // On error the binding is unchanged and the select goes back
            showListSet(listBinding[state.listMode]);
        }
    }

    function handleListBindingChange(e) {
        const value = e.target.value;
        if (!LIST_SETS.includes(value)) return;
        // The two modes must use different sets: the other mode gets the other one
        const mode = state.listMode;
        const next = { [mode]: value, [otherListMode(mode)]: otherListSet(value) };
        if (next.split === listBinding.split) return;
        saveListBinding(next);
    }

    function swapListBinding() {
        const message = t('lists.swapConfirm', {
            toVpnPrimary: LIST_SET_NAMES[listBinding.split],
            toSplit: LIST_SET_NAMES[listBinding.vpnprimary]
        });
        if (!confirm(message)) return;
        saveListBinding({ split: listBinding.vpnprimary, vpnprimary: listBinding.split });
    }

    // Main page, routing tile (the owner calls it "Segments"): open it and scroll there
    function goToSegments() {
        switchTab('vpn');
        const tile = $('#routing-tile');
        if (!tile || tile.classList.contains('hidden')) return;
        if (!tile.classList.contains('expanded')) toggleRoutingTile();
        tile.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Entries of a list for comparison: no comments, no "*." prefix, lower-case
    function listEntries(content) {
        return content.split('\n')
            .map(line => line.replace(/#.*/, '').trim().toLowerCase().replace(/^\*\./, ''))
            .filter(Boolean);
    }

    function hideListOverlapWarnings() {
        $$('.list-overlap-warning').forEach(el => {
            el.classList.add('hidden');
            el.innerHTML = '';
        });
    }

    // After a save: warn about entries that are also in the other set's list of the same type
    async function checkListOverlap(kind, type, content, listSet) {
        const warning = $(`#${kind}-overlap-${type}`);
        if (!warning) return;
        try {
            const data = await api(withListSet(`/${kind}.cgi?type=${type}`, otherListSet(listSet)));
            if (!data.success || !data.data || listSet !== state.listSet) return;
            const other = new Set(listEntries(data.data.content?.replace(/\\n/g, '\n') || ''));
            const common = [...new Set(listEntries(content))].filter(entry => other.has(entry));
            if (common.length === 0) return;

            let items = common.slice(0, 5).map(entry => `<strong>${escapeHtml(entry)}</strong>`).join(', ');
            if (common.length > 5) items += ' ' + t('lists.overlapMore', { n: common.length - 5 });
            const key = common.length > 1 ? 'lists.overlapWarning'
                : (kind === 'subnets' ? 'lists.overlapWarningSubnetOne' : 'lists.overlapWarningOne');
            warning.innerHTML = t(key, { items });
            warning.classList.remove('hidden');
        } catch (error) {
            console.error('Failed to check list overlap:', error);
        }
    }

    // ============================================
    // Domains (TCP+UDP and UDP-only)
    // ============================================
    
    // Domain subtab switching
    function switchDomainsSubtab(subtabName) {
        state.currentDomainsSubtab = subtabName;
        
        elements.subtabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.subtab === subtabName);
        });
        
        elements.subtabContents.forEach(content => {
            content.classList.toggle('hidden', content.id !== `subtab-${subtabName}`);
            content.classList.toggle('active', content.id === `subtab-${subtabName}`);
        });
    }
    
    async function loadDomains() {
        try {
            const listSet = state.listSet;
            const tcpUdpData = await api(withListSet('/domains.cgi?type=tcpudp', listSet));
            const udpOnlyData = await api(withListSet('/domains.cgi?type=udponly', listSet));
            // Set switched while loading: the newer load fills the editors
            if (listSet !== state.listSet) return;

            // TCP+UDP domains
            if (tcpUdpData.success && tcpUdpData.data) {
                const content = tcpUdpData.data.content?.replace(/\\n/g, '\n') || '';
                if (elements.domainsEditorTcpUdp) {
                    elements.domainsEditorTcpUdp.value = content;
                }
                state.domainsTcpUdpOriginal = content;
                updateLineNumbers('tcpudp');
            }
            
            // UDP-only domains
            if (udpOnlyData.success && udpOnlyData.data) {
                const content = udpOnlyData.data.content?.replace(/\\n/g, '\n') || '';
                if (elements.domainsEditorUdpOnly) {
                    elements.domainsEditorUdpOnly.value = content;
                }
                state.domainsUdpOnlyOriginal = content;
                updateLineNumbers('udponly');
            }
            
            // Update stats
            const tcpUdpCount = tcpUdpData.data?.domains_count || 0;
            const udpOnlyCount = udpOnlyData.data?.domains_count || 0;
            elements.domainsStats.textContent = `TCP+UDP: ${tcpUdpCount} | UDP-only: ${udpOnlyCount}`;
            
        } catch (error) {
            showToast(t('errors.loadDomains'), 'error');
        }
    }

    function updateLineNumbers(type) {
        if (type === 'tcpudp' && elements.domainsEditorTcpUdp && elements.lineNumbersTcpUdp) {
            const lines = elements.domainsEditorTcpUdp.value.split('\n');
            elements.lineNumbersTcpUdp.innerHTML = lines.map((_, i) => i + 1).join('<br>');
        } else if (type === 'udponly' && elements.domainsEditorUdpOnly && elements.lineNumbersUdpOnly) {
            const lines = elements.domainsEditorUdpOnly.value.split('\n');
            elements.lineNumbersUdpOnly.innerHTML = lines.map((_, i) => i + 1).join('<br>');
        }
    }

    // File upload/download handlers for editors
    function setupFileHandlers(prefix, type, editor) {
        const uploadBtn = $(`#${prefix}-upload-${type}-btn`);
        const downloadBtn = $(`#${prefix}-download-${type}-btn`);
        const fileInput = $(`#${prefix}-file-${type}`);
        
        if (uploadBtn && fileInput && editor) {
            uploadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                fileInput.click();
            });
            
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const newContent = event.target.result.trim();
                        
                        // Replace content with file contents
                        editor.value = newContent;
                        
                        // Trigger update for line numbers
                        editor.dispatchEvent(new Event('input'));
                        showToast(t('lists.loadedFrom').replace('{file}', file.name), 'success');
                    };
                    reader.readAsText(file);
                }
                // Reset file input
                fileInput.value = '';
            });
        }
        
        if (downloadBtn && editor) {
            downloadBtn.addEventListener('click', () => {
                const content = editor.value.trim();
                if (!content) {
                    showToast(t('warning.listEmpty'), 'warning');
                    return;
                }
                
                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${prefix}-${type}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                showToast(t('success.fileDownloaded'), 'success');
            });
        }
    }

    async function saveDomains(type) {
        const isTcpUdp = type === 'tcpudp';
        const editor = isTcpUdp ? elements.domainsEditorTcpUdp : elements.domainsEditorUdpOnly;
        const btn = isTcpUdp ? elements.domainsSaveTcpUdpBtn : elements.domainsSaveUdpOnlyBtn;
        const validation = isTcpUdp ? elements.domainsValidationTcpUdp : elements.domainsValidationUdpOnly;
        
        if (!editor || !btn) return;
        
        const content = editor.value;
        const originalText = btn.textContent;
        
        // Show loader
        btn.disabled = true;
        btn.innerHTML = `<span class="btn-spinner"></span> ${t('lists.saving')}`;
        if (validation) {
            validation.textContent = t('lists.savingAndApplying');
            validation.className = 'validation-message';
        }
        
        const listSet = state.listSet;

        try {
            $(`#domains-overlap-${type}`)?.classList.add('hidden');
            const data = await api(withListSet(`/domains.cgi/save?type=${type}`, listSet), {
                method: 'POST',
                body: JSON.stringify({ content, type })
            });
            
            if (data.success) {
                if (isTcpUdp) {
                    state.domainsTcpUdpOriginal = content;
                } else {
                    state.domainsUdpOnlyOriginal = content;
                }
                
                if (validation) {
                    validation.textContent = t('lists.savedSuccess');
                    validation.className = 'validation-message success';
                }
                const setSuffix = ` (${LIST_SET_NAMES[listSet]})`;
                showToast(t('lists.domainsSaved').replace('{type}', (isTcpUdp ? 'TCP+UDP' : 'UDP-only') + setSuffix), 'success');
                checkListOverlap('domains', type, content, listSet);
                
                if (data.data?.singbox_applied) {
                    showToast(t('success.rulesUpdated'), 'info');
                }
                
                const skipped = parseInt(data.data?.skipped_count || 0, 10);
                if (skipped > 0) {
                    const sample = (data.data.skipped_sample || '').split('|').filter(Boolean).slice(0, 3).join(', ');
                    const msg = t('lists.invalidLinesSkipped').replace('{n}', skipped) + (sample ? ` (${sample})` : '');
                    showToast(msg, 'warning');
                }
                
                // Update stats
                loadDomains();
            }
        } catch (error) {
            if (validation) {
                validation.textContent = error.message;
                validation.className = 'validation-message error';
            }
            showToast(t(error.message) || error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    // ============================================
    // Subnets (TCP+UDP and UDP-only)
    // ============================================
    
    // Subnet subtab switching
    function switchSubnetsSubtab(subtabName) {
        state.currentSubnetsSubtab = subtabName;
        
        if (elements.subnetsSubtabs) {
            elements.subnetsSubtabs.forEach(tab => {
                tab.classList.toggle('active', tab.dataset.subtab === subtabName);
            });
        }
        
        // Switch subtab content
        const tcpudpContent = $('#subtab-subnets-tcpudp');
        const udponlyContent = $('#subtab-subnets-udponly');
        
        if (tcpudpContent) {
            tcpudpContent.classList.toggle('hidden', subtabName !== 'subnets-tcpudp');
            tcpudpContent.classList.toggle('active', subtabName === 'subnets-tcpudp');
        }
        if (udponlyContent) {
            udponlyContent.classList.toggle('hidden', subtabName !== 'subnets-udponly');
            udponlyContent.classList.toggle('active', subtabName === 'subnets-udponly');
        }
    }
    
    async function loadSubnets() {
        try {
            const listSet = state.listSet;
            const tcpUdpData = await api(withListSet('/subnets.cgi?type=tcpudp', listSet));
            const udpOnlyData = await api(withListSet('/subnets.cgi?type=udponly', listSet));
            // Set switched while loading: the newer load fills the editors
            if (listSet !== state.listSet) return;

            // TCP+UDP subnets
            if (tcpUdpData.success && tcpUdpData.data) {
                const content = tcpUdpData.data.content?.replace(/\\n/g, '\n') || '';
                if (elements.subnetsEditorTcpUdp) {
                    elements.subnetsEditorTcpUdp.value = content;
                }
                state.subnetsTcpUdpOriginal = content;
                updateSubnetLineNumbers('tcpudp');
            }
            
            // UDP-only subnets
            if (udpOnlyData.success && udpOnlyData.data) {
                const content = udpOnlyData.data.content?.replace(/\\n/g, '\n') || '';
                if (elements.subnetsEditorUdpOnly) {
                    elements.subnetsEditorUdpOnly.value = content;
                }
                state.subnetsUdpOnlyOriginal = content;
                updateSubnetLineNumbers('udponly');
            }
            
            // Update stats
            const tcpUdpCount = tcpUdpData.data?.subnets_count || 0;
            const udpOnlyCount = udpOnlyData.data?.subnets_count || 0;
            if (elements.subnetsStats) {
                elements.subnetsStats.textContent = `TCP+UDP: ${tcpUdpCount} | UDP-only: ${udpOnlyCount}`;
            }
            
        } catch (error) {
            showToast(t('errors.loadSubnets'), 'error');
        }
    }

    function updateSubnetLineNumbers(type) {
        if (type === 'tcpudp' && elements.subnetsEditorTcpUdp && elements.lineNumbersSubnetsTcpUdp) {
            const lines = elements.subnetsEditorTcpUdp.value.split('\n');
            elements.lineNumbersSubnetsTcpUdp.innerHTML = lines.map((_, i) => i + 1).join('<br>');
        } else if (type === 'udponly' && elements.subnetsEditorUdpOnly && elements.lineNumbersSubnetsUdpOnly) {
            const lines = elements.subnetsEditorUdpOnly.value.split('\n');
            elements.lineNumbersSubnetsUdpOnly.innerHTML = lines.map((_, i) => i + 1).join('<br>');
        }
    }

    async function saveSubnets(type) {
        const isTcpUdp = type === 'tcpudp';
        const editor = isTcpUdp ? elements.subnetsEditorTcpUdp : elements.subnetsEditorUdpOnly;
        const btn = isTcpUdp ? elements.subnetsSaveTcpUdpBtn : elements.subnetsSaveUdpOnlyBtn;
        const validation = isTcpUdp ? elements.subnetsValidationTcpUdp : elements.subnetsValidationUdpOnly;
        
        if (!editor || !btn) return;
        
        const content = editor.value;
        const originalText = btn.textContent;
        
        // Show loader
        btn.disabled = true;
        btn.innerHTML = `<span class="btn-spinner"></span> ${t('lists.saving')}`;
        if (validation) {
            validation.textContent = t('lists.savingAndApplying');
            validation.className = 'validation-message';
        }
        
        const listSet = state.listSet;

        try {
            $(`#subnets-overlap-${type}`)?.classList.add('hidden');
            const data = await api(withListSet(`/subnets.cgi/save?type=${type}`, listSet), {
                method: 'POST',
                body: JSON.stringify({ content, type })
            });
            
            if (data.success) {
                if (isTcpUdp) {
                    state.subnetsTcpUdpOriginal = content;
                } else {
                    state.subnetsUdpOnlyOriginal = content;
                }
                
                if (validation) {
                    validation.textContent = t('lists.savedSuccess');
                    validation.className = 'validation-message success';
                }
                const setSuffix = ` (${LIST_SET_NAMES[listSet]})`;
                showToast(t('lists.subnetsSaved').replace('{type}', (isTcpUdp ? 'TCP+UDP' : 'UDP-only') + setSuffix), 'success');
                checkListOverlap('subnets', type, content, listSet);
                
                if (data.data?.rules_applied) {
                    showToast(t('success.iptablesUpdated'), 'info');
                }
                
                const skippedSn = parseInt(data.data?.skipped_count || 0, 10);
                if (skippedSn > 0) {
                    const sample = (data.data.skipped_sample || '').split('|').filter(Boolean).slice(0, 3).join(', ');
                    const msg = t('lists.invalidLinesSkipped').replace('{n}', skippedSn) + (sample ? ` (${sample})` : '');
                    showToast(msg, 'warning');
                }
                
                // Update stats
                loadSubnets();
            }
        } catch (error) {
            if (validation) {
                validation.textContent = error.message;
                validation.className = 'validation-message error';
            }
            showToast(t(error.message) || error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    // ============================================
    // Devices — DISABLED: does not work correctly with PSN and other services
    // For device routing use native Keenetic WireGuard
    // ============================================
    // async function loadDevices() { ... }
    // function renderDevices() { ... }
    // function openDeviceModal() { ... }
    // async function addDevice(formData) { ... }
    // async function toggleDevice(ip, enabled) { ... }
    // async function deleteDevice(ip) { ... }

    // ============================================
    // Settings
    // ============================================
    async function loadSystemInfo() {
        try {
            const data = await api('/status.cgi');
            
            if (data.success && data.data) {
                $('#info-version').textContent = data.data.version || '1.0.0';
                
                if (data.data.system) {
                    const uptime = data.data.system.uptime;
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    $('#info-uptime').textContent = `${hours}${t('time.h')} ${minutes}${t('time.min')}`;
                    
                    const memTotal = Math.round(data.data.system.memory.total / 1024);
                    const memFree = Math.round(data.data.system.memory.free / 1024);
                    $('#info-memory').textContent = `${memFree} / ${memTotal} MB`;
                    
                    const diskTotal = Math.round(data.data.system.disk.total / 1024);
                    const diskFree = Math.round(data.data.system.disk.free / 1024);
                    $('#info-disk').textContent = `${diskFree} / ${diskTotal} MB`;
                }
            }
        } catch (error) {
            // Ignore
        }
        
        // Load donation wallet
        loadDonateSetting();
    }

    // Verbose sing-box logging: on for an hour, then the router turns it off itself
    function renderVerboseLogState(until) {
        const status = $('#verbose-log-status');
        const btn = $('#btn-verbose-log');
        const active = until && until * 1000 > Date.now();
        if (status) {
            status.textContent = active
                ? t('settings.verboseActiveUntil', { time: new Date(until * 1000).toLocaleTimeString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' }) })
                : t('settings.verboseInactive');
        }
        if (btn) {
            btn.dataset.active = active ? '1' : '0';
            btn.textContent = active ? t('settings.verboseOff') : t('settings.verboseOn');
        }
    }

    async function loadVerboseLogState() {
        try {
            const data = await api('/settings.cgi');
            if (data.success) renderVerboseLogState(data.data.verbose_log_until);
        } catch (error) {
            console.error('Failed to load log settings:', error);
        }
    }

    async function toggleVerboseLog() {
        const btn = $('#btn-verbose-log');
        const enable = btn?.dataset.active !== '1';
        if (!confirm(t('settings.verboseConfirm'))) return;
        if (btn) btn.disabled = true;
        try {
            const data = await api('/settings.cgi/verbose-log', {
                method: 'POST',
                body: JSON.stringify({ enabled: enable })
            });
            renderVerboseLogState(data.data?.verbose_log_until);
            showToast(enable ? t('settings.verboseEnabled') : t('settings.verboseDisabled'), 'success');
        } catch (error) {
            showToast(t('errors.withMessage', { message: error.message }), 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function downloadRouterLog() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/logs.cgi/download`, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const name = (response.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1]
                || 'router-log.txt';
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = url;
            link.download = name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (error) {
            showToast(`${t('logs.downloadFailed')}: ${error.message}`, 'error');
        }
    }

    async function loadDonateSetting() {
        try {
            const data = await api('/settings.cgi');
            if (data.success && data.data && data.data.usdt_wallet) {
                state.usdtWallet = data.data.usdt_wallet;
                const donateBtn = $('#donate-btn');
                if (donateBtn) donateBtn.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    async function changePasswordFromSettings(currentPassword, newPassword) {
        try {
            await api('/auth.cgi/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });
            
            showToast(t('success.passwordChanged'), 'success');
            hideModal(elements.settingsModal);
        } catch (error) {
            showToast(t(error.message) || error.message, 'error');
        }
    }

    // ============================================
    // Web Port Settings
    // ============================================
    async function loadWebPortSettings() {
        try {
            const response = await api('/settings.cgi');
            if (!response.success || !response.data) return;
            
            const data = response.data;
            const portInput = $('#settings-web-port');
            if (portInput && data.web_port) {
                portInput.value = data.web_port;
                portInput.placeholder = data.default_port || 8001;
            }
        } catch (error) {
            console.error('Failed to load web port settings:', error);
        }
    }

    async function changeWebPort(newPort) {
        try {
            const response = await api('/settings.cgi/port', {
                method: 'POST',
                body: JSON.stringify({ port: parseInt(newPort) })
            });
            
            if (response.success && response.data) {
                const newUrl = response.data.new_url;
                showPortChangeSuccessModal(newUrl, newPort);
            } else {
                showToast(t('success.portChanged'), 'success');
            }
        } catch (error) {
            showToast(t(error.message) || t('errors.portChange'), 'error');
        }
    }

    function showPortChangeConfirmModal(newPort) {
        const currentHost = window.location.hostname;
        const newUrl = `http://${currentHost}:${newPort}`;
        
        const modal = $('#port-change-modal');
        const newUrlEl = $('#port-change-new-url');
        const confirmBtn = $('#port-change-confirm');
        const cancelBtn = $('#port-change-cancel');
        
        if (!modal) {
            // Fallback if modal not found
            if (confirm(t('port.changeConfirm').replace('{port}', newPort).replace('{url}', newUrl))) {
                changeWebPort(newPort);
            }
            return;
        }
        
        newUrlEl.textContent = newUrl;
        newUrlEl.href = newUrl;
        
        // Remove old handlers
        const newConfirmBtn = confirmBtn.cloneNode(true);
        const newCancelBtn = cancelBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
        newCancelBtn.addEventListener('click', () => {
            hideModal(modal);
        });
        
        newConfirmBtn.addEventListener('click', async () => {
            newConfirmBtn.disabled = true;
            newConfirmBtn.textContent = t('lists.saving');
            await changeWebPort(newPort);
            hideModal(modal);
        });
        
        showModal(modal);
    }

    function showPortChangeSuccessModal(newUrl, newPort) {
        const modal = $('#port-change-success-modal');
        const urlEl = $('#port-success-url');
        const redirectBtn = $('#port-success-redirect');
        
        if (!modal) {
            // Fallback
            showToast(t('port.changed').replace('{port}', newPort).replace('{url}', newUrl), 'success');
            setTimeout(() => {
                window.location.href = newUrl;
            }, 3000);
            return;
        }
        
        urlEl.textContent = newUrl;
        urlEl.href = newUrl;
        
        // Remove old handlers
        const newRedirectBtn = redirectBtn.cloneNode(true);
        redirectBtn.parentNode.replaceChild(newRedirectBtn, redirectBtn);
        
        newRedirectBtn.addEventListener('click', () => {
            window.location.href = newUrl;
        });
        
        // Close settings modal if open
        hideModal(elements.settingsModal);
        showModal(modal);
        
        // Auto redirect in 5 seconds
        let countdown = 5;
        const countdownEl = $('#port-success-countdown');
        if (countdownEl) {
            countdownEl.textContent = countdown;
            const interval = setInterval(() => {
                countdown--;
                countdownEl.textContent = countdown;
                if (countdown <= 0) {
                    clearInterval(interval);
                    window.location.href = newUrl;
                }
            }, 1000);
        }
    }

    // ============================================
    // Lists Source Settings (FEAT-200)
    // ============================================
    // ============================================
    // Updates (B2)
    // ============================================

    // The script records why it failed; the panel has to say it out loud rather
    // than leave the last good answer on screen looking fresh.
    const UPDATE_FAIL_TEXT = {
        'check-unreachable': 'updateFail.unreachable',
        'check-bad-manifest': 'updateFail.badManifest',
        'no-source': 'updateFail.noSource',
        'download-failed': 'updateFail.download',
        'checksum-mismatch': 'updateFail.checksum',
        'bad-archive': 'updateFail.archive',
        'backup-failed': 'updateFail.backup',
        'install-failed': 'updateFail.install',
        'self-check-failed': 'updateFail.selfCheck',
        'no-sha256sum': 'updateFail.noSha',
        'archive-too-big': 'updateFail.tooBig'
    };

    let updatePollTimer = null;

    function setUpdateLine(el, text, cls) {
        if (!el) return;
        el.textContent = text || '';
        el.className = 'form-hint' + (cls ? ' ' + cls : '');
    }

    function renderUpdateState(d) {
        const cb = $('#settings-auto-update');
        if (cb) cb.checked = d.auto_update !== false;

        const src = $('#settings-update-source');
        if (src && document.activeElement !== src) src.value = d.source || '';

        const installed = $('#update-installed');
        if (installed) installed.textContent = d.installed || d.current || '—';

        const newer = d.available && d.available !== (d.installed || d.current);
        const available = $('#update-available');
        if (available) available.textContent = newer ? d.available : '—';

        setUpdateLine($('#update-notes'), newer ? (d.notes || '') : '', 'text-muted');

        const statusEl = $('#update-status');
        const btnApply = $('#btn-update-apply');
        const btnCheck = $('#btn-update-check');

        if (d.running) {
            setUpdateLine(statusEl, t('settings.updateRunning'), 'text-warning');
            if (btnApply) { btnApply.disabled = true; btnApply.hidden = false; }
            if (btnCheck) btnCheck.disabled = true;
            startUpdatePolling();
            return;
        }

        stopUpdatePolling();
        // Nothing newer to install: no button that looks pressable but does nothing
        if (btnApply) { btnApply.disabled = !newer; btnApply.hidden = !newer; }
        if (btnCheck) btnCheck.disabled = false;

        const failKey = UPDATE_FAIL_TEXT[d.last_result];
        if (failKey) {
            setUpdateLine(statusEl, t(failKey), 'text-error');
        } else if (d.last_result === 'updated') {
            setUpdateLine(statusEl, t('success.updateDone').replace('{version}', d.installed || d.current || ''), 'text-success');
        } else if (d.held && newer) {
            setUpdateLine(statusEl, t('settings.updateHeld'), 'text-warning');
        } else if (!newer && d.checked_at) {
            setUpdateLine(statusEl, t('settings.updateNone'), 'text-muted');
        } else if (d.checked_at) {
            setUpdateLine(statusEl, t('settings.updateCheckedAt').replace('{time}', d.checked_at), 'text-muted');
        } else {
            setUpdateLine(statusEl, '', 'text-muted');
        }
    }

    function startUpdatePolling() {
        if (updatePollTimer) return;
        updatePollTimer = setInterval(loadUpdateSettings, 3000);
    }

    function stopUpdatePolling() {
        if (!updatePollTimer) return;
        clearInterval(updatePollTimer);
        updatePollTimer = null;
    }

    async function loadUpdateSettings() {
        try {
            const response = await api('/update.cgi');
            if (response.success) renderUpdateState(response.data || {});
        } catch (error) {
            stopUpdatePolling();
            setUpdateLine($('#update-status'), error.message || t('errors.unknown'), 'text-error');
        }
    }

    async function checkUpdateNow() {
        const btn = $('#btn-update-check');
        if (btn) btn.disabled = true;
        try {
            const response = await api('/update.cgi/check', { method: 'POST' });
            if (response.success) {
                renderUpdateState(response.data || {});
                showToast(t('success.updateChecked'), 'success');
            }
        } catch (error) {
            setUpdateLine($('#update-status'), error.message || t('errors.unknown'), 'text-error');
            showToast(error.message || t('errors.unknown'), 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function applyUpdateNow() {
        if (!confirm(t('settings.confirmUpdateNow'))) return;
        // Show the update as running right away, not when the router answers
        const btnApply = $('#btn-update-apply');
        const btnCheck = $('#btn-update-check');
        if (btnApply) btnApply.disabled = true;
        if (btnCheck) btnCheck.disabled = true;
        setUpdateLine($('#update-status'), t('settings.updateRunning'), 'text-warning');
        try {
            const response = await api('/update.cgi/apply', { method: 'POST' });
            if (response.success) {
                renderUpdateState(response.data || {});
                showToast(t('success.updateStarted'), 'success');
                startUpdatePolling();
            }
        } catch (error) {
            setUpdateLine($('#update-status'), error.message || t('errors.unknown'), 'text-error');
            showToast(error.message || t('errors.unknown'), 'error');
            await loadUpdateSettings();
        }
    }

    async function toggleAutoUpdate(enabled) {
        try {
            const response = await api('/update.cgi/toggle', {
                method: 'POST',
                body: JSON.stringify({ enabled })
            });
            if (response.success) {
                renderUpdateState(response.data || {});
                showToast(t(enabled ? 'success.autoUpdateOn' : 'success.autoUpdateOff'), 'success');
            }
        } catch (error) {
            showToast(error.message || t('errors.unknown'), 'error');
            await loadUpdateSettings();
        }
    }

    async function saveUpdateSource(url) {
        try {
            const response = await api('/update.cgi/source', {
                method: 'POST',
                body: JSON.stringify({ url })
            });
            if (response.success) {
                renderUpdateState(response.data || {});
                showToast(t('success.updateSourceSaved'), 'success');
            }
        } catch (error) {
            showToast(error.message || t('errors.unknown'), 'error');
        }
    }

    async function loadListsSourceSettings() {
        try {
            const response = await api('/settings.cgi');
            if (!response.success || !response.data) return;
            
            const data = response.data;
            const urlInput = $('#settings-lists-source-url');
            if (urlInput && data.lists_source_url) {
                urlInput.value = data.lists_source_url;
                urlInput.placeholder = data.default_lists_source || 'https://raw.githubusercontent.com/user/repo/branch';
            }
        } catch (error) {
            console.error('Failed to load lists source settings:', error);
        }
    }

    async function saveListsSource(newUrl) {
        try {
            const response = await api('/settings.cgi/lists-source', {
                method: 'POST',
                body: JSON.stringify({ url: newUrl })
            });
            
            if (response.success) {
                showToast(t('success.listsSourceSaved'), 'success');
                await loadListsSourceSettings();
            }
        } catch (error) {
            showToast(t(error.message) || t('errors.listsSourceSave'), 'error');
        }
    }

    async function resetListsSource() {
        try {
            const response = await api('/settings.cgi/lists-source-reset', {
                method: 'POST'
            });
            
            if (response.success) {
                showToast(t('success.listsSourceReset'), 'success');
                await loadListsSourceSettings();
            }
        } catch (error) {
            showToast(t(error.message) || t('errors.listsSourceReset'), 'error');
        }
    }

    // ============================================
    // dnsmasq Port Settings (FEAT-202) — DANGER ZONE
    // ============================================
    async function loadDnsmasqPortSettings() {
        try {
            const response = await api('/settings.cgi');
            if (!response.success || !response.data) return;
            
            const data = response.data;
            const portInput = $('#settings-dnsmasq-port');
            if (portInput && data.dnsmasq_port) {
                portInput.value = data.dnsmasq_port;
                portInput.placeholder = data.default_dnsmasq_port || 5353;
            }
        } catch (error) {
            console.error('Failed to load dnsmasq port settings:', error);
        }
    }

    async function changeDnsmasqPort(newPort, btnEl) {
        const btn = btnEl || $('#btn-change-dnsmasq-port');
        const originalHtml = btn ? btn.innerHTML : '';
        
        if (btn) {
            btn.disabled = true;
            btn.classList.add('btn-loading');
            btn.innerHTML = `<span class="btn-spinner"></span> ${t('settings.restarting')}`;
        }
        
        try {
            const response = await api('/settings.cgi/dnsmasq-port', {
                method: 'POST',
                body: JSON.stringify({ port: parseInt(newPort) })
            });
            
            if (response.success) {
                showToast(t('success.dnsmasqPortChanged'), 'success');
                await loadDnsmasqPortSettings();
            }
        } catch (error) {
            showToast(t(error.message) || t('errors.dnsmasqPortChange'), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('btn-loading');
                btn.textContent = t('settings.changePort');
            }
        }
    }

    // ============================================
    // Utilities
    // ============================================
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function clearIntervals() {
        if (state.statusInterval) {
            clearInterval(state.statusInterval);
            state.statusInterval = null;
        }
        if (state.checkInterval) {
            clearInterval(state.checkInterval);
            state.checkInterval = null;
        }
    }

    // ============================================
    // Initialization
    // ============================================
    function initApp() {
        updatePageTranslations();
        loadStatus();
        loadConfigs();
        loadSubscriptions();
        loadAutostartStatus();
        loadNetworkStatus();
        loadDonateSettings();
        
        if (window.VPNFailover?.init) window.VPNFailover.init();
        if (window.VPNFailover?.reload) window.VPNFailover.reload();
        loadMultiState();
        
        // Set link to router web interface (without port 8001)
        const routerLink = $('#router-portfwd-link');
        if (routerLink) {
            const routerUrl = `http://${window.location.hostname}/portForwarding`;
            routerLink.href = routerUrl;
        }
        
        // Status refresh interval
        state.statusInterval = setInterval(loadStatus, CONFIG.STATUS_INTERVAL);
        
    }
    
    // Load autostart status
    async function loadAutostartStatus() {
        try {
            const response = await api('/vpn.cgi/active/autostart-status');
            console.log('Autostart API response:', response);
            const autostart = response.data?.autostart ?? response.autostart;
            console.log('Autostart value:', autostart);
            if (autostart !== undefined) {
                state.autostart = autostart;
                if (elements.autostartToggle) {
                    elements.autostartToggle.checked = autostart;
                    console.log('Autostart toggle set to:', autostart);
                }
            }
        } catch (error) {
            console.error('Failed to load autostart status:', error);
        }
    }
    
    // Toggle autostart
    async function toggleAutostart(enabled) {
        try {
            const action = enabled ? 'autostart-enable' : 'autostart-disable';
            const response = await api(`/vpn.cgi/active/${action}`, { method: 'POST' });
            const autostart = response.data?.autostart ?? response.autostart;
            state.autostart = autostart;
            const message = response.data?.message ?? response.message;
            showToast(message || (enabled ? t('autostart.enabled') : t('autostart.disabled')), 'success');
        } catch (error) {
            // Revert checkbox state
            if (elements.autostartToggle) {
                elements.autostartToggle.checked = !enabled;
            }
            showToast(t('errors.withMessage', {message: error.message}), 'error');
        }
    }

    function initEventListeners() {
        initMultiMode();
        
        // Language selector
        const langSelect = document.getElementById('language-select');
        if (langSelect) {
            // Set initial value from current language
            langSelect.value = currentLanguage;
            
            langSelect.addEventListener('change', (e) => {
                setLanguage(e.target.value);
            });
        }
        
        // Apply translations on initial load
        updatePageTranslations();
        
        // Login form
        elements.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            elements.loginError.classList.add('hidden');
            
            const username = $('#username').value;
            const password = $('#password').value;
            
            try {
                await login(username, password);
            } catch (error) {
                elements.loginError.textContent = error.message;
                elements.loginError.classList.remove('hidden');
            }
        });
        
        // Change password form
        elements.changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            elements.passwordError.classList.add('hidden');
            
            const newPassword = $('#new-password').value;
            const confirmPassword = $('#confirm-password').value;
            
            if (newPassword !== confirmPassword) {
                elements.passwordError.textContent = t('password.mismatch');
                elements.passwordError.classList.remove('hidden');
                return;
            }
            
            if (newPassword.length < 8) {
                elements.passwordError.textContent = t('password.tooShort');
                elements.passwordError.classList.remove('hidden');
                return;
            }
            
            try {
                await changePassword(newPassword);
            } catch (error) {
                elements.passwordError.textContent = error.message;
                elements.passwordError.classList.remove('hidden');
            }
        });
        
        // Auth setup form (initial setup)
        const authSetupDisableBtn = $('#auth-setup-disable');
        const authSetupPasswordBtn = $('#auth-setup-password');
        const authSetupPasswordForm = $('#auth-setup-password-form');
        const authSetupError = $('#auth-setup-error');
        
        if (authSetupDisableBtn) {
            authSetupDisableBtn.addEventListener('click', async () => {
                try {
                    await setupAuth('disabled');
                } catch (error) {
                    if (authSetupError) {
                        authSetupError.textContent = error.message;
                        authSetupError.classList.remove('hidden');
                    }
                }
            });
        }
        
        if (authSetupPasswordBtn) {
            authSetupPasswordBtn.addEventListener('click', () => {
                // Show password entry form
                authSetupPasswordForm?.classList.remove('hidden');
                authSetupPasswordBtn.classList.add('hidden');
                authSetupDisableBtn?.classList.add('hidden');
            });
        }
        
        if (authSetupPasswordForm) {
            authSetupPasswordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newPassword = $('#auth-setup-new-password')?.value;
                const confirmPassword = $('#auth-setup-confirm-password')?.value;
                
                if (newPassword !== confirmPassword) {
                    if (authSetupError) {
                        authSetupError.textContent = t('password.mismatch');
                        authSetupError.classList.remove('hidden');
                    }
                    return;
                }
                
                if (newPassword.length < 8) {
                    if (authSetupError) {
                        authSetupError.textContent = t('password.tooShort');
                        authSetupError.classList.remove('hidden');
                    }
                    return;
                }
                
                try {
                    await setupAuth('password', newPassword);
                } catch (error) {
                    if (authSetupError) {
                        authSetupError.textContent = error.message;
                        authSetupError.classList.remove('hidden');
                    }
                }
            });
        }
        
        // Logout
        elements.logoutBtn.addEventListener('click', logout);
        
        // Autostart toggle
        if (elements.autostartToggle) {
            elements.autostartToggle.addEventListener('change', (e) => {
                toggleAutostart(e.target.checked);
            });
        }
        
        // Settings
        elements.settingsBtn.addEventListener('click', () => {
            loadSystemInfo();
            loadWebPortSettings();
            loadListsSourceSettings();
            loadDnsmasqPortSettings();
            loadVerboseLogState();
            loadUpdateSettings();
            showModal(elements.settingsModal);
        });
        
        // Routing tile expand/collapse
        const routingTileHeader = $('.routing-tile-header');
        if (routingTileHeader) {
            routingTileHeader.addEventListener('click', (e) => {
                // Don't switch if clicked on policy control
                if (e.target.closest('.policy-btn, .policy-select')) return;
                toggleRoutingTile();
            });
        }
        
        // Load routing tile on startup
        loadRoutingTile();
        
        // Segments refresh button
        const routingRefreshBtn = $('#routing-refresh-btn');
        if (routingRefreshBtn) {
            routingRefreshBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                refreshSegmentsCache();
            });
        }
        
        // Recalculate overflow on resize
        window.addEventListener('resize', debounce(checkHeaderOverflow, 150));
        
        // Port change button
        const btnChangePort = $('#btn-change-port');
        if (btnChangePort) {
            btnChangePort.addEventListener('click', () => {
                const portInput = $('#settings-web-port');
                const newPort = portInput?.value;
                
                if (!newPort) {
                    showToast(t('errors.portRequired'), 'error');
                    return;
                }
                
                const port = parseInt(newPort);
                if (isNaN(port) || port < 1024 || port > 65535) {
                    showToast(t('errors.portRange'), 'error');
                    return;
                }
                
                // Reserved ports
                const reserved = [22, 53, 80, 222, 443, 5353, 8080, 8388];
                if (reserved.includes(port)) {
                    showToast(t('port.reserved').replace('{port}', port), 'error');
                    return;
                }
                
                showPortChangeConfirmModal(port);
            });
        }
        
        // Lists source save button (FEAT-200)
        // Updates (B2)
        const btnUpdateCheck = $('#btn-update-check');
        if (btnUpdateCheck) {
            btnUpdateCheck.addEventListener('click', () => checkUpdateNow());
        }

        const btnUpdateApply = $('#btn-update-apply');
        if (btnUpdateApply) {
            btnUpdateApply.addEventListener('click', () => applyUpdateNow());
        }

        const cbAutoUpdate = $('#settings-auto-update');
        if (cbAutoUpdate) {
            cbAutoUpdate.addEventListener('change', () => toggleAutoUpdate(cbAutoUpdate.checked));
        }

        const btnSaveUpdateSource = $('#btn-save-update-source');
        if (btnSaveUpdateSource) {
            btnSaveUpdateSource.addEventListener('click', () => {
                const value = $('#settings-update-source')?.value.trim() || '';
                // Empty is allowed: that is how updates are switched off entirely.
                if (value && !value.startsWith('https://')) {
                    showToast(t('errors.urlInvalid'), 'error');
                    return;
                }
                saveUpdateSource(value);
            });
        }

        const btnSaveListsSource = $('#btn-save-lists-source');
        if (btnSaveListsSource) {
            btnSaveListsSource.addEventListener('click', () => {
                const urlInput = $('#settings-lists-source-url');
                const newUrl = urlInput?.value.trim();
                
                if (!newUrl) {
                    showToast(t('errors.urlRequired'), 'error');
                    return;
                }
                
                if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
                    showToast(t('errors.urlInvalid'), 'error');
                    return;
                }
                
                saveListsSource(newUrl);
            });
        }
        
        // Lists source reset button (FEAT-200)
        const btnResetListsSource = $('#btn-reset-lists-source');
        if (btnResetListsSource) {
            btnResetListsSource.addEventListener('click', () => {
                if (confirm(t('settings.confirmResetListsSource'))) {
                    resetListsSource();
                }
            });
        }
        
        // dnsmasq port change button (FEAT-202) — DANGER ZONE
        const btnChangeDnsmasqPort = $('#btn-change-dnsmasq-port');
        if (btnChangeDnsmasqPort) {
            btnChangeDnsmasqPort.addEventListener('click', () => {
                const portInput = $('#settings-dnsmasq-port');
                const newPort = portInput?.value;
                
                if (!newPort) {
                    showToast(t('errors.portRequired'), 'error');
                    return;
                }
                
                const port = parseInt(newPort);
                if (isNaN(port) || port < 1024 || port > 65535) {
                    showToast(t('errors.portRange'), 'error');
                    return;
                }
                
                // Critical confirmation dialog
                const message = t('settings.confirmChangeDnsmasqPort')
                    .replace('{port}', port)
                    .replace('{default}', '5353');
                
                if (confirm(message)) {
                    changeDnsmasqPort(port, btnChangeDnsmasqPort);
                }
            });
        }
        
        // Verbose log toggle and log download
        $('#btn-verbose-log')?.addEventListener('click', toggleVerboseLog);
        $('#logs-download-btn')?.addEventListener('click', downloadRouterLog);

        // Full backup / restore
        // JSON error body of a failed backup request, or a generic key for anything else
        async function backupError(response) {
            try {
                const data = await response.json();
                return data.error || 'backup.internal';
            } catch {
                return response.status === 401 ? 'backup.unauthorized' : 'backup.internal';
            }
        }

        $('#btn-backup-export')?.addEventListener('click', async () => {
            const btn = $('#btn-backup-export');
            btn.disabled = true;
            try {
                const response = await fetch(`${CONFIG.API_BASE}/backup.cgi/export`, { credentials: 'same-origin' });
                if (!response.ok || !(response.headers.get('Content-Type') || '').includes('gzip')) {
                    throw new Error(await backupError(response));
                }
                const name = (response.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1]
                    || 'vpn-manager-backup.tar.gz';
                const url = URL.createObjectURL(await response.blob());
                const link = document.createElement('a');
                link.href = url;
                link.download = name;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                showToast(t('backup.downloadStarted'), 'success');
            } catch (error) {
                showToast(`${t('backup.downloadFailed')}: ${t(error.message)}`, 'error', 8000);
            } finally {
                btn.disabled = false;
            }
        });

        $('#backup-restore-file')?.addEventListener('change', (e) => {
            const name = e.target.files?.[0]?.name || '';
            const el = $('#backup-file-name');
            el.textContent = name;
            el.classList.toggle('hidden', !name);
        });

        $('#btn-backup-restore')?.addEventListener('click', async () => {
            const btn = $('#btn-backup-restore');
            const file = $('#backup-restore-file')?.files?.[0];
            if (!file) {
                showToast(t('backup.chooseFile'), 'error');
                return;
            }
            if (!confirm(t('backup.confirmRestore'))) return;

            const hwid = $('#backup-restore-hwid')?.checked ? '1' : '0';
            btn.disabled = true;
            try {
                const response = await fetch(`${CONFIG.API_BASE}/backup.cgi/restore?hwid=${hwid}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: file,
                    credentials: 'same-origin'
                });
                if (!response.ok) {
                    throw new Error(await backupError(response));
                }
                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || 'backup.internal');
                }
                showToast(t('backup.restored', data.data), 'success', 8000);
                if (data.data.active_missing) {
                    showToast(t('backup.activeMissing'), 'warning', 10000);
                }
                setTimeout(() => window.location.reload(), 3000);
            } catch (error) {
                showToast(`${t('backup.restoreFailed')}: ${t(error.message)}`, 'error', 8000);
            } finally {
                btn.disabled = false;
            }
        });

        // Settings password form
        $('#settings-password-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const currentPassword = $('#settings-current-password').value;
            const newPassword = $('#settings-new-password').value;
            const confirmPassword = $('#settings-confirm-password').value;
            
            if (newPassword !== confirmPassword) {
                showToast(t('errors.passwordMismatch'), 'error');
                return;
            }
            
            await changePasswordFromSettings(currentPassword, newPassword);
        });
        
        // Auth mode settings
        const authModeDisabled = $('#auth-mode-disabled');
        const authModePassword = $('#auth-mode-password');
        const enablePasswordForm = $('#enable-password-form');
        const btnEnablePassword = $('#btn-enable-password');
        const btnDisablePassword = $('#btn-disable-password');
        const btnCancelEnable = $('#btn-cancel-enable');
        
        // Show correct mode when opening settings
        elements.settingsBtn?.addEventListener('click', () => {
            updateAuthModeUI();
        });
        
        function updateAuthModeUI() {
            if (authModeDisabled && authModePassword && enablePasswordForm) {
                authModeDisabled.classList.add('hidden');
                authModePassword.classList.add('hidden');
                enablePasswordForm.classList.add('hidden');
                
                if (state.authMode === 'disabled') {
                    authModeDisabled.classList.remove('hidden');
                } else {
                    authModePassword.classList.remove('hidden');
                }
            }
        }
        
        btnEnablePassword?.addEventListener('click', () => {
            authModeDisabled?.classList.add('hidden');
            enablePasswordForm?.classList.remove('hidden');
        });
        
        btnCancelEnable?.addEventListener('click', () => {
            enablePasswordForm?.classList.add('hidden');
            authModeDisabled?.classList.remove('hidden');
        });
        
        btnDisablePassword?.addEventListener('click', async () => {
            const currentPassword = $('#settings-current-password').value;
            if (!currentPassword) {
                showToast(t('errors.currentPasswordRequired'), 'error');
                return;
            }
            
            try {
                let success;
                try {
                    success = await changeAuthMode('disabled', null, currentPassword);
                } catch (error) {
                    // B8: VPN clients can reach the panel — only after an explicit warning
                    if (error.message !== 'errors.vpnLanAccessPasswordRisk') throw error;
                    if (!confirm(t('server.lanAccessDisablePasswordConfirm'))) return;
                    success = await changeAuthMode('disabled', null, currentPassword, true);
                }
                if (success) {
                    updateAuthModeUI();
                    $('#settings-current-password').value = '';
                }
            } catch (error) {
                showToast(t(error.message) || error.message, 'error');
            }
        });
        
        enablePasswordForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPassword = $('#enable-new-password').value;
            const confirmPassword = $('#enable-confirm-password').value;
            const errorEl = $('#enable-password-error');
            
            if (newPassword !== confirmPassword) {
                if (errorEl) {
                    errorEl.textContent = t('password.mismatch');
                    errorEl.classList.remove('hidden');
                }
                return;
            }
            
            if (newPassword.length < 8) {
                if (errorEl) {
                    errorEl.textContent = t('password.tooShort');
                    errorEl.classList.remove('hidden');
                }
                return;
            }
            
            try {
                const success = await changeAuthMode('password', newPassword);
                if (success) {
                    updateAuthModeUI();
                    $('#enable-new-password').value = '';
                    $('#enable-confirm-password').value = '';
                    errorEl?.classList.add('hidden');
                }
            } catch (error) {
                if (errorEl) {
                    errorEl.textContent = error.message;
                    errorEl.classList.remove('hidden');
                }
            }
        });
        
        // ============================================
        // Recovery handlers
        // ============================================
        
        // "Forgot password?" link
        elements.forgotPasswordLink?.addEventListener('click', (e) => {
            e.preventDefault();
            showScreen('recovery');
        });
        
        // Back to login link
        elements.backToLoginLink?.addEventListener('click', (e) => {
            e.preventDefault();
            showScreen('login');
        });
        
        // Recovery form submit
        elements.recoveryForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            elements.recoveryError?.classList.add('hidden');
            
            const code = elements.recoveryCodeInput?.value?.trim();
            if (!code) {
                elements.recoveryError.textContent = t('password.enterRecovery');
                elements.recoveryError?.classList.remove('hidden');
                return;
            }
            
            try {
                const data = await api('/auth.cgi/recover', {
                    method: 'POST',
                    body: JSON.stringify({ recovery_code: code })
                });
                
                if (data.success) {
                    showToast(t('success.accessRestored'), 'success');
                    elements.recoveryCodeInput.value = '';
                    showScreen('login');
                    // Fill login fields
                    $('#username').value = 'admin';
                    $('#password').value = '';
                    $('#password').focus();
                }
            } catch (error) {
                elements.recoveryError.textContent = error.message;
                elements.recoveryError?.classList.remove('hidden');
            }
        });
        
        // Recovery code modal: copy button
        elements.copyRecoveryCodeBtn?.addEventListener('click', async () => {
            const code = elements.recoveryCodeDisplay?.textContent;
            if (code) {
                try {
                    await navigator.clipboard.writeText(code);
                    showToast(t('success.codeCopied'), 'success');
                } catch (err) {
                    // Fallback for old browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = code;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    showToast(t('success.codeCopied'), 'success');
                }
            }
        });
        
        // Recovery code modal: confirm button
        elements.recoveryCodeConfirmBtn?.addEventListener('click', () => {
            hideModal(elements.recoveryCodeModal);
            showScreen('main');
            initApp();
            showToast(t('success.passwordSet'), 'success');
        });
        
        // Onboarding tooltip: dismiss button
        elements.onboardingDismiss?.addEventListener('click', () => {
            dismissOnboarding();
        });
        
        // Tab navigation
        elements.tabs.forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });
        
        // Modal close buttons
        $$('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                hideAllModals();
            });
        });
        
        // Modal overlay click — only close if mousedown also started on the overlay
        let overlayMouseDownTarget = null;
        elements.modalOverlay.addEventListener('mousedown', (e) => {
            overlayMouseDownTarget = e.target;
        });
        elements.modalOverlay.addEventListener('click', (e) => {
            if (e.target === elements.modalOverlay && overlayMouseDownTarget === elements.modalOverlay) {
                hideAllModals();
            }
            overlayMouseDownTarget = null;
        });
        
        // Add config button
        elements.addConfigBtn.addEventListener('click', () => openConfigModal());
        
        // Start VPN button
        const startVpnBtn = $('#start-vpn-btn');
        if (startVpnBtn) {
            startVpnBtn.addEventListener('click', () => startVpn());
        }
        
        // Stop VPN button
        const stopVpnBtn = $('#stop-vpn-btn');
        if (stopVpnBtn) {
            stopVpnBtn.addEventListener('click', () => stopVpn());
        }
        
        // Check IP button
        const checkIpBtn = $('#check-ip-btn');
        if (checkIpBtn) {
            checkIpBtn.addEventListener('click', () => checkVpnIp());
        }
        
        // IPv6 toggle button
        const ipv6ToggleBtn = $('#ipv6-toggle-btn');
        if (ipv6ToggleBtn) {
            ipv6ToggleBtn.addEventListener('click', () => toggleIPv6());
        }
        
        // Open port button
        const openPortBtn = $('#open-port-btn');
        if (openPortBtn) {
            openPortBtn.addEventListener('click', () => openPort8388());
        }
        
        // Import URL button
        const importUrlBtn = $('#import-url-btn');
        if (importUrlBtn) {
            importUrlBtn.addEventListener('click', () => openImportModal());
        }
        
        // Import modal buttons
        const importParseBtn = $('#import-parse-btn');
        const importSaveBtn = $('#import-save-btn');
        if (importParseBtn) {
            importParseBtn.addEventListener('click', () => parseImportUrl());
        }
        if (importSaveBtn) {
            importSaveBtn.addEventListener('click', () => saveImportedConfig());
        }
        
        // Subscription buttons
        const subPreviewBtn = $('#subscription-preview-btn');
        const subSaveBtn = $('#subscription-save-btn');
        if (subPreviewBtn) {
            subPreviewBtn.addEventListener('click', () => previewSubscription());
        }
        if (subSaveBtn) {
            subSaveBtn.addEventListener('click', () => saveSubscription());
        }
        
        // Auto-update checkbox toggle for interval
        const autoUpdateCheckbox = $('#subscription-auto-update');
        if (autoUpdateCheckbox) {
            autoUpdateCheckbox.addEventListener('change', (e) => {
                const intervalGroup = $('#subscription-interval-group');
                if (intervalGroup) {
                    intervalGroup.style.display = e.target.checked ? '' : 'none';
                }
            });
        }
        
        // Import tabs
        $$('.import-tab').forEach(tab => {
            tab.addEventListener('click', () => switchImportTab(tab.dataset.importTab));
        });
        
        // File input handler
        const fileInput = $('#import-file');
        const fileUploadArea = $('#file-upload-area');
        const fileContentArea = $('#import-file-content');
        const fileNameDisplay = $('#file-name');
        
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    fileNameDisplay.textContent = file.name;
                    fileNameDisplay.classList.remove('hidden');
                    
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if (fileContentArea) {
                            fileContentArea.value = event.target.result;
                        }
                    };
                    reader.readAsText(file);
                }
            });
        }
        
        if (fileUploadArea) {
            fileUploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                fileUploadArea.classList.add('dragover');
            });
            fileUploadArea.addEventListener('dragleave', () => {
                fileUploadArea.classList.remove('dragover');
            });
            fileUploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                fileUploadArea.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file && fileInput) {
                    // Create a new FileList-like object
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    fileInput.files = dataTransfer.files;
                    fileInput.dispatchEvent(new Event('change'));
                }
            });
        }
        
        // Config form
        elements.configForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveConfig(new FormData(e.target));
        });
        
        // IPv6 checkbox — show warning on change
        const ipv6Checkbox = $('#config-ipv6');
        const ipv6WarningBanner = $('#ipv6-warning-banner');
        if (ipv6Checkbox && ipv6WarningBanner) {
            ipv6Checkbox.addEventListener('change', () => {
                const initialValue = ipv6Checkbox.dataset.initialValue;
                const currentValue = String(ipv6Checkbox.checked);
                if (initialValue !== currentValue) {
                    ipv6WarningBanner.style.display = 'block';
                } else {
                    ipv6WarningBanner.style.display = 'none';
                }
            });
        }
        
        // Password toggle
        $$('.toggle-password').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = btn.previousElementSibling;
                input.type = input.type === 'password' ? 'text' : 'password';
            });
        });
        
        // Protocol selector
        const protocolSelect = $('#config-protocol');
        if (protocolSelect) {
            protocolSelect.addEventListener('change', (e) => {
                showProtocolFields(e.target.value);
            });
            
            // Hide AmneziaWG option if disabled (bug in sing-box-extended wireguard-go)
            if (!CONFIG.AMNEZIAWG_ENABLED) {
                const awgOption = protocolSelect.querySelector('option[value="amneziawg"]');
                if (awgOption) {
                    awgOption.style.display = 'none';
                    awgOption.disabled = true;
                }
            }
        }
        
        // VLESS TLS toggle
        const vlessTls = $('#vless-tls');
        if (vlessTls) {
            vlessTls.addEventListener('change', (e) => {
                const tlsOptions = $('#vless-tls-options');
                if (tlsOptions) {
                    tlsOptions.classList.toggle('hidden', !e.target.checked);
                }
            });
        }
        
        // VLESS security (TLS vs Reality)
        const vlessSecurity = $('#vless-security');
        if (vlessSecurity) {
            vlessSecurity.addEventListener('change', (e) => {
                const realityOptions = $('#vless-reality-options');
                if (realityOptions) {
                    realityOptions.classList.toggle('hidden', e.target.value !== 'reality');
                }
            });
        }
        
        // VMess TLS toggle
        const vmessTls = $('#vmess-tls');
        if (vmessTls) {
            vmessTls.addEventListener('change', (e) => {
                const tlsOptions = $('#vmess-tls-options');
                if (tlsOptions) {
                    tlsOptions.classList.toggle('hidden', !e.target.checked);
                }
            });
        }
        
        // Subtabs (domains types)
        elements.subtabs.forEach(tab => {
            tab.addEventListener('click', () => switchDomainsSubtab(tab.dataset.subtab));
        });
        
        // Domains editor - TCP+UDP
        if (elements.domainsEditorTcpUdp) {
            elements.domainsEditorTcpUdp.addEventListener('input', () => updateLineNumbers('tcpudp'));
            elements.domainsEditorTcpUdp.addEventListener('scroll', () => {
                if (elements.lineNumbersTcpUdp) {
                    elements.lineNumbersTcpUdp.style.top = -elements.domainsEditorTcpUdp.scrollTop + 'px';
                }
            });
        }
        
        // Domains editor - UDP-only
        if (elements.domainsEditorUdpOnly) {
            elements.domainsEditorUdpOnly.addEventListener('input', () => updateLineNumbers('udponly'));
            elements.domainsEditorUdpOnly.addEventListener('scroll', () => {
                if (elements.lineNumbersUdpOnly) {
                    elements.lineNumbersUdpOnly.style.top = -elements.domainsEditorUdpOnly.scrollTop + 'px';
                }
            });
        }
        
        // Save buttons for domains
        if (elements.domainsSaveTcpUdpBtn) {
            elements.domainsSaveTcpUdpBtn.addEventListener('click', () => saveDomains('tcpudp'));
        }
        if (elements.domainsSaveUdpOnlyBtn) {
            elements.domainsSaveUdpOnlyBtn.addEventListener('click', () => saveDomains('udponly'));
        }
        
        // Subnets subtabs
        if (elements.subnetsSubtabs) {
            elements.subnetsSubtabs.forEach(tab => {
                tab.addEventListener('click', () => switchSubnetsSubtab(tab.dataset.subtab));
            });
        }

        // B1: mode tabs, list selector and swap link (shared by Domains and Subnets tabs)
        $$('.list-mode-tab').forEach(btn => {
            btn.addEventListener('click', () => switchListMode(btn.dataset.listMode));
        });
        $$('.list-binding-select').forEach(select => {
            select.addEventListener('change', handleListBindingChange);
        });
        $$('.list-swap-btn').forEach(btn => {
            btn.addEventListener('click', swapListBinding);
        });
        // "Segments" links sit inside translated texts, so they are caught here
        document.addEventListener('click', (e) => {
            if (!e.target.closest('[data-goto-segments]')) return;
            e.preventDefault();
            goToSegments();
        });
        updateListModeUI();
        
        // Subnets editor - TCP+UDP
        if (elements.subnetsEditorTcpUdp) {
            elements.subnetsEditorTcpUdp.addEventListener('input', () => updateSubnetLineNumbers('tcpudp'));
            elements.subnetsEditorTcpUdp.addEventListener('scroll', () => {
                if (elements.lineNumbersSubnetsTcpUdp) {
                    elements.lineNumbersSubnetsTcpUdp.style.top = -elements.subnetsEditorTcpUdp.scrollTop + 'px';
                }
            });
        }
        
        // Subnets editor - UDP-only
        if (elements.subnetsEditorUdpOnly) {
            elements.subnetsEditorUdpOnly.addEventListener('input', () => updateSubnetLineNumbers('udponly'));
            elements.subnetsEditorUdpOnly.addEventListener('scroll', () => {
                if (elements.lineNumbersSubnetsUdpOnly) {
                    elements.lineNumbersSubnetsUdpOnly.style.top = -elements.subnetsEditorUdpOnly.scrollTop + 'px';
                }
            });
        }
        
        // Save buttons for subnets
        if (elements.subnetsSaveTcpUdpBtn) {
            elements.subnetsSaveTcpUdpBtn.addEventListener('click', () => saveSubnets('tcpudp'));
        }
        if (elements.subnetsSaveUdpOnlyBtn) {
            elements.subnetsSaveUdpOnlyBtn.addEventListener('click', () => saveSubnets('udponly'));
        }
        
        // File upload/download for domains
        setupFileHandlers('domains', 'tcpudp', elements.domainsEditorTcpUdp);
        setupFileHandlers('domains', 'udponly', elements.domainsEditorUdpOnly);
        
        // File upload/download for subnets
        setupFileHandlers('subnets', 'tcpudp', elements.subnetsEditorTcpUdp);
        setupFileHandlers('subnets', 'udponly', elements.subnetsEditorUdpOnly);
        
        // Add device button — DISABLED
        // elements.addDeviceBtn.addEventListener('click', openDeviceModal);
        
        // Device form — DISABLED
        // elements.deviceForm.addEventListener('submit', (e) => {
        //     e.preventDefault();
        //     addDevice(new FormData(e.target));
        // });
        
        // VPN Server (ssserver) buttons
        const ssserverStartBtn = $('#ssserver-start-btn');
        const ssserverStopBtn = $('#ssserver-stop-btn');
        const ssserverRestartBtn = $('#ssserver-restart-btn');
        const addSSUserBtn = $('#add-ssuser-btn');
        const ssUserForm = $('#ssuser-form');
        
        if (ssserverStartBtn) {
            ssserverStartBtn.addEventListener('click', ssserverStart);
        }
        if (ssserverStopBtn) {
            ssserverStopBtn.addEventListener('click', ssserverStop);
        }
        if (ssserverRestartBtn) {
            ssserverRestartBtn.addEventListener('click', ssserverRestart);
        }
        if (addSSUserBtn) {
            addSSUserBtn.addEventListener('click', openSSUserModal);
        }
        const exportBtn = $('#export-ssusers-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', openExportSSUsersModal);
        }
        const importBtn = $('#import-ssusers-btn');
        if (importBtn) {
            importBtn.addEventListener('click', openImportSSUsersModal);
        }
        const exportConfirmBtn = $('#export-ssusers-confirm-btn');
        if (exportConfirmBtn) {
            exportConfirmBtn.addEventListener('click', confirmExportSSUsers);
        }
        const exportSelectAll = $('#export-ssusers-selectall');
        if (exportSelectAll) {
            exportSelectAll.addEventListener('change', (e) => {
                $$('#export-ssusers-list input[type="checkbox"][data-username]').forEach(cb => {
                    cb.checked = e.target.checked;
                });
            });
        }
        const importConfirmBtn = $('#import-ssusers-confirm-btn');
        if (importConfirmBtn) {
            importConfirmBtn.addEventListener('click', confirmImportSSUsers);
        }

        // Configuration export
        const exportConfigsBtn = $('#export-configs-btn');
        if (exportConfigsBtn) {
            exportConfigsBtn.addEventListener('click', openExportConfigsModal);
        }
        const exportConfigsConfirm = $('#export-configs-confirm-btn');
        if (exportConfigsConfirm) {
            exportConfigsConfirm.addEventListener('click', confirmExportConfigs);
        }
        const exportConfigsCopy = $('#export-configs-copy-btn');
        if (exportConfigsCopy) {
            exportConfigsCopy.addEventListener('click', copyExportConfigsText);
        }
        const exportConfigsBack = $('#export-configs-back-btn');
        if (exportConfigsBack) {
            exportConfigsBack.addEventListener('click', () => showExportConfigsStep('select'));
        }
        const exportConfigsSelectAll = $('#export-configs-selectall');
        if (exportConfigsSelectAll) {
            exportConfigsSelectAll.addEventListener('change', (e) => {
                $$('#export-configs-list input[type="checkbox"]').forEach(cb => {
                    cb.checked = e.target.checked;
                });
            });
        }
        // The download buttons are rendered per export, so delegate instead of
        // rebinding them each time the result view is filled in.
        const exportConfigsFilesList = $('#export-configs-files-list');
        if (exportConfigsFilesList) {
            exportConfigsFilesList.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-export-file]');
                if (btn) downloadExportConfigFile(Number(btn.dataset.exportFile));
            });
        }
        const importFileInput = $('#import-ssusers-file');
        if (importFileInput) {
            importFileInput.addEventListener('change', previewImportSSUsersFile);
        }
        if (ssUserForm) {
            ssUserForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = $('#ssuser-name').value.trim();
                if (name) {
                    const submitBtn = ssUserForm.querySelector('button[type="submit"]');
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.textContent = '...';
                    }
                    try {
                        await addSSUser(name);
                    } finally {
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = t('vpn.add');
                        }
                    }
                }
            });
        }
        
        // VPN Server Port Change (FEAT-201)
        const btnChangeServerPort = $('#btn-change-server-port');
        if (btnChangeServerPort) {
            btnChangeServerPort.addEventListener('click', () => {
                const portInput = $('#server-port-input');
                const newPort = portInput?.value;
                
                if (!newPort) {
                    showToast(t('errors.portRequired'), 'error');
                    return;
                }
                
                const port = parseInt(newPort);
                if (isNaN(port) || port < 1024 || port > 65535) {
                    showToast(t('errors.portRange'), 'error');
                    return;
                }
                
                // Confirmation dialog with warning
                if (confirm(t('server.portChangeWarning').replace('{port}', port))) {
                    changeServerPort(port, btnChangeServerPort);
                }
            });
        }
        
        // Rename user form
        const ssUserRenameForm = $('#ssuser-rename-form');
        if (ssUserRenameForm) {
            ssUserRenameForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await confirmRenameSSUser();
            });
        }
        
        // Delete user confirm button
        const ssUserDeleteBtn = $('#ssuser-delete-confirm-btn');
        if (ssUserDeleteBtn) {
            ssUserDeleteBtn.addEventListener('click', async () => {
                await confirmDeleteSSUser();
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideAllModals();
            }
        });
        
        // Donate button
        const donateBtn = $('#donate-btn');
        if (donateBtn) {
            donateBtn.addEventListener('click', openDonateModal);
        }
        
        // Donate copy button
        const donateCopyBtn = $('#donate-copy-btn');
        if (donateCopyBtn) {
            donateCopyBtn.addEventListener('click', () => {
                if (state.usdtWallet) {
                    copyToClipboard(state.usdtWallet);
                    showToast(t('donate.copied'), 'success');
                }
            });
        }
        
        // Logs button
        const logsBtn = $('#logs-btn');
        if (logsBtn) {
            logsBtn.addEventListener('click', openLogsModal);
        }
        
        // Logs tabs
        $$('.logs-tab').forEach(tab => {
            tab.addEventListener('click', () => loadLog(tab.dataset.log));
        });
        
        // Logs refresh button
        const logsRefreshBtn = $('#logs-refresh-btn');
        if (logsRefreshBtn) {
            logsRefreshBtn.addEventListener('click', () => loadLog(state.currentLogName));
        }
        
        // Logs copy button
        const logsCopyBtn = $('#logs-copy-btn');
        if (logsCopyBtn) {
            logsCopyBtn.addEventListener('click', copyCurrentLog);
        }
        
        // Logs clear button
        const logsClearBtn = $('#logs-clear-btn');
        if (logsClearBtn) {
            logsClearBtn.addEventListener('click', clearCurrentLog);
        }
        
        // Logs clear all button
        const logsClearAllBtn = $('#logs-clear-all-btn');
        if (logsClearAllBtn) {
            logsClearAllBtn.addEventListener('click', clearAllLogs);
        }
        
        // File upload handlers
        $$('.file-upload-input').forEach(input => {
            input.addEventListener('change', handleFileUpload);
        });
        
        // File download handlers
        $$('[data-download]').forEach(btn => {
            btn.addEventListener('click', handleFileDownload);
        });
    }
    
    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const targetId = e.target.dataset.target;
        const textarea = $(`#${targetId}`);
        if (!textarea) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            if (textarea.value.trim() && !confirm(t('lists.replaceConfirm'))) {
                textarea.value = textarea.value.trim() + '\n' + content;
            } else {
                textarea.value = content;
            }
            textarea.dispatchEvent(new Event('input'));
            showToast(t('lists.fileLoaded').replace('{file}', file.name), 'success');
        };
        reader.onerror = () => showToast(t('errors.readFile'), 'error');
        reader.readAsText(file);
        e.target.value = '';
    }
    
    function handleFileDownload(e) {
        const targetId = e.currentTarget.dataset.download;
        const filename = e.currentTarget.dataset.filename || 'list.txt';
        const textarea = $(`#${targetId}`);
        
        if (!textarea || !textarea.value.trim()) {
            showToast(t('warning.listEmpty'), 'warning');
            return;
        }
        
        const blob = new Blob([textarea.value], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(t('lists.fileDownloaded').replace('{file}', filename), 'success');
    }
    
    function copyCurrentLog() {
        const logsOutput = $('#logs-output');
        if (logsOutput && logsOutput.textContent) {
            copyToClipboard(logsOutput.textContent);
        } else {
            showToast(t('warning.logEmpty'), 'warning');
        }
    }

    // Start application
    document.addEventListener('DOMContentLoaded', () => {
        initEventListeners();
        checkAuth();
    });

    // ============================================
    // VPN Server (ssserver) Functions
    // ============================================
    
    async function loadSSServerStatus() {
        try {
            console.log('Loading VPN Server status...');
            const response = await fetch(`${CONFIG.API_BASE}/vpnserver.cgi`);
            if (!response.ok) {
                console.error('VPN Server status response not ok:', response.status);
                return;
            }
            
            const data = await response.json();
            console.log('VPN Server status loaded:', data);
            state.ssserver = data;
            updateSSServerUI();
            console.log('VPN Server UI updated');
        } catch (error) {
            console.error('Failed to load VPN Server status:', error);
        }
    }
    
    // B8: what VPN-server clients can reach at home — off / panel / lan
    const VPN_LAN_MODES = ['off', 'panel', 'lan'];

    async function loadVpnLanAccess() {
        const select = $('#vpn-lan-access-select');
        const btn = $('#btn-vpn-lan-access');
        if (!select || !btn) return;
        if (!btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => saveVpnLanAccess(select.value));
        }
        const status = $('#vpn-lan-access-status');
        try {
            const data = await api('/settings.cgi');
            const d = data.success && data.data ? data.data : {};
            if (!VPN_LAN_MODES.includes(d.vpn_lan_access)) throw new Error('errors.vpnLanAccessFailed');
            state.vpnLanAccess = d.vpn_lan_access;
            select.value = state.vpnLanAccess;
            select.disabled = false;
            btn.disabled = false;
            // Chosen, but not given: the panel has no password (after a recovery or a reinstall)
            const inactive = state.vpnLanAccess !== 'off' && d.vpn_lan_access_active === 'off';
            if (status) {
                status.textContent = inactive ? t('server.lanAccessInactive') : '';
                status.classList.toggle('hidden', !inactive);
            }
            // Where the panel opens from a phone on the VPN (no VPN-client settings needed)
            const address = $('#vpn-lan-access-address');
            const active = d.vpn_lan_access_active && d.vpn_lan_access_active !== 'off';
            if (address) {
                address.textContent = active && d.vpn_panel_name && d.vpn_panel_ip && d.web_port
                    ? `${t('server.lanAccessPanelAddress')} http://${d.vpn_panel_name}:${d.web_port} ` +
                      `(${t('server.lanAccessPanelOr')} http://${d.vpn_panel_ip}:${d.web_port})`
                    : '';
                address.classList.toggle('hidden', !address.textContent);
            }
        } catch (error) {
            console.error('Failed to load VPN LAN access:', error);
            // Do not show "no access" when the real value is unknown
            select.disabled = true;
            btn.disabled = true;
        }
    }

    async function saveVpnLanAccess(mode) {
        if (!VPN_LAN_MODES.includes(mode)) return;
        const select = $('#vpn-lan-access-select');
        const btn = $('#btn-vpn-lan-access');
        btn.disabled = true;
        select.disabled = true;
        try {
            const data = await api('/settings.cgi/vpn-lan-access', {
                method: 'POST',
                body: JSON.stringify({ mode })
            });
            if (data.success === false) {
                throw new Error(data.error || 'errors.vpnLanAccessFailed');
            }
            state.vpnLanAccess = mode;
            showToast(t('server.lanAccessSaved'), 'success');
            // Status line and panel address follow the new state
            loadVpnLanAccess();
        } catch (error) {
            if (error.message === 'errors.vpnLanAccessNeedsPassword') {
                // No password yet: open the settings with the form for setting one
                showToast(t('errors.vpnLanAccessNeedsPassword'), 'warning', 10000);
                elements.settingsBtn?.click();
                setTimeout(() => $('#btn-enable-password')?.click(), 50);
            } else {
                // t() returns the key itself when there is no text for it
                const text = t(error.message);
                showToast(text && text !== error.message ? text : t('errors.vpnLanAccessFailed'), 'error');
            }
        } finally {
            btn.disabled = false;
            select.disabled = false;
            // On error the setting is unchanged and the select goes back
            select.value = state.vpnLanAccess || 'off';
        }
    }

    function updateSSServerUI() {
        const credentials = $('#ssserver-credentials');
        const users = $('#ssserver-users');
        
        // Update port input (FEAT-201)
        const portInput = $('#server-port-input');
        if (portInput && state.ssserver.server_port) {
            portInput.value = state.ssserver.server_port;
        }
        
        if (!state.ssserver.configured) {
            if (credentials) credentials.innerHTML = `<p class="text-muted">${t('server.notConfigured')}</p>`;
            if (users) users.innerHTML = `<p class="text-muted">${t('server.unavailable')}</p>`;
            return;
        }
        
        const running = state.ssserver.status?.running || state.ssserver.status?.port_open;
        const hasUsers = state.ssserver.users && state.ssserver.users.length > 0;
        
        // Credentials - now for VLESS (or Shadowsocks for compatibility)
        const hasCredentials = state.ssserver.public_key || state.ssserver.server_key || 
                               (state.ssserver.protocol === 'vless' && state.ssserver.transport === 'ws');
        if (hasCredentials) {
            // Form warnings (collect in array for display)
            let alerts = [];
            
            // NAT warning — three states:
            //   is_nat=true,  uncertain=false → red/orange "behind NAT" (definite)
            //   is_nat=true,  uncertain=true  → orange "probably behind NAT" (couldn't verify)
            //   is_nat=false                  → green "direct IP" (confirmed)
            if (state.ssserver.is_nat) {
                const uncertain = !!state.ssserver.is_nat_uncertain;
                const externalIp = state.ssserver.external_ip || t('server.notDetermined');
                const headline = uncertain
                    ? t('server.behindNatProbable')
                    : t('server.behindNat');
                const ipLine = uncertain
                    ? `<p>${t('server.externalIpUnknown')}</p>`
                    : `<p>${t('server.externalIp')}: <code>${externalIp}</code></p>`;
                alerts.push(`
                    <div class="alert alert-warning">
                        <strong>⚠️ ${headline}</strong>
                        ${ipLine}
                        <p>${t('server.natWarning')}</p>
                    </div>
                `);
            } else {
                alerts.push(`
                    <div class="alert alert-success">
                        <strong>✓ ${t('server.directIp')}</strong>
                        <p>${t('server.directIpInfo')}: <code>${state.ssserver.external_ip}</code></p>
                    </div>
                `);
            }
            
            // IP detection service warning (only for external services)
            if (state.ssserver.detection_method && 
                state.ssserver.detection_method !== 'ddns' && 
                state.ssserver.detection_method !== 'keendns' && 
                state.ssserver.detection_method !== 'local' && 
                state.ssserver.detection_method !== 'none') {
                alerts.push(`
                    <div class="alert alert-info">
                        <strong>ℹ️ ${t('server.attention')}</strong>
                        <p>${t('server.dontAddToVpn').replace('{method}', `<code>${state.ssserver.detection_method}</code>`)}</p>
                    </div>
                `);
            }
            
            // DDNS info
            if (state.ssserver.detection_method === 'ddns') {
                alerts.push(`
                    <div class="alert alert-success">
                        <strong>✓ DDNS</strong>
                        <p>${t('server.ddnsInfo')}</p>
                    </div>
                `);
            }
            
            // IP detection services warning (always shown)
            alerts.push(`
                <div class="alert alert-info">
                    <strong>ℹ️ ${t('server.important')}</strong>
                    <p>${t('server.dontAddIpServices')} <code>api.ipify.org</code>, <code>ifconfig.me</code>, <code>icanhazip.com</code></p>
                </div>
            `);
            
            const serverWarnings = alerts.length > 0 
                ? `<div class="alerts-grid">${alerts.join('')}</div>` 
                : '';
            
            // Show IP separately if DDNS is used
            const ipInfo = (state.ssserver.detection_method === 'ddns' && state.ssserver.server_ip) 
                ? `<div class="server-ip-hint">
                    IP: <code id="ss-server-ip">${state.ssserver.server_ip}</code>
                    <button type="button" class="btn btn-icon btn-copy btn-xs" data-copy="ss-server-ip" title="${t('actions.copy')} IP">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                        </svg>
                    </button>
                </div>` 
                : '';
            
            // VLESS or Shadowsocks depending on protocol
            const isVless = state.ssserver.protocol === 'vless';
            const isWebSocket = state.ssserver.transport === 'ws';
            const port = state.ssserver.server_port || state.ssserver.port || 8388;
            
            if (isVless) {
                const transportInfo = isWebSocket 
                    ? `<div class="credential-item">
                            <label>${t('server.transport')}</label>
                            <div class="credential-value">
                                <code>WebSocket</code>
                            </div>
                        </div>
                        <div class="credential-item">
                            <label>${t('server.path')}</label>
                            <div class="credential-value">
                                <code id="vless-ws-path">${state.ssserver.ws_path || '/vless-ws'}</code>
                                <button type="button" class="btn btn-icon btn-copy" data-copy="vless-ws-path" title="${t('actions.copy')}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                    </svg>
                                </button>
                            </div>
                        </div>`
                    : `<div class="credential-item">
                            <label>SNI</label>
                            <div class="credential-value">
                                <code id="vless-sni">${state.ssserver.sni || 'www.google.com'}</code>
                            </div>
                        </div>
                        <div class="credential-item full-width">
                            <label>Public Key (Reality)</label>
                            <div class="credential-value">
                                <code id="vless-public-key" class="text-truncate">${state.ssserver.public_key}</code>
                            </div>
                        </div>
                        <div class="credential-item">
                            <label>Short ID</label>
                            <div class="credential-value">
                                <code id="vless-short-id">${state.ssserver.short_id || ''}</code>
                            </div>
                        </div>`;
                
                credentials.innerHTML = `
                    <div class="credentials-grid">
                        <div class="credential-item">
                            <label>${t('server.server')}</label>
                            <div class="credential-value">
                                <code id="vless-server-addr">${state.ssserver.server || t('server.notDefined')}</code>
                                <button type="button" class="btn btn-icon btn-copy" data-copy="vless-server-addr" title="${t('actions.copy')}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                    </svg>
                                </button>
                            </div>
                            ${ipInfo}
                            ${serverWarnings}
                        </div>
                        <div class="credential-item">
                            <label>${t('server.port')}</label>
                            <div class="credential-value">
                                <code id="vless-port">${port}</code>
                                <button type="button" class="btn btn-icon btn-copy" data-copy="vless-port" title="${t('actions.copy')}">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div class="credential-item">
                            <label>${t('server.protocol')}</label>
                            <div class="credential-value">
                                <code>VLESS${isWebSocket ? ' + WebSocket' : ' + Reality'}</code>
                            </div>
                        </div>
                        ${transportInfo}
                    </div>
                    <p class="hint">${t('server.useVlessHint')}</p>
                `;
            } else {
            credentials.innerHTML = `
                <div class="credentials-grid">
                    <div class="credential-item">
                        <label>${t('server.server')}</label>
                        <div class="credential-value">
                            <code id="ss-server-addr">${state.ssserver.server || t('server.notDefined')}</code>
                            <button type="button" class="btn btn-icon btn-copy" data-copy="ss-server-addr" title="${t('actions.copy')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                </svg>
                            </button>
                        </div>
                        ${ipInfo}
                        ${serverWarnings}
                    </div>
                    <div class="credential-item">
                        <label>${t('server.port')}</label>
                        <div class="credential-value">
                                <code id="ss-server-port">${port}</code>
                            <button type="button" class="btn btn-icon btn-copy" data-copy="ss-server-port" title="${t('actions.copy')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="credential-item">
                        <label>${t('server.method')}</label>
                        <div class="credential-value">
                            <code id="ss-method-val">${state.ssserver.method || '2022-blake3-aes-256-gcm'}</code>
                            <button type="button" class="btn btn-icon btn-copy" data-copy="ss-method-val" title="${t('actions.copy')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="credential-item full-width">
                        <label>${t('server.serverKey')}</label>
                        <div class="credential-value">
                            <code id="ss-server-key" class="text-truncate">${state.ssserver.server_key}</code>
                            <button type="button" class="btn btn-icon btn-copy" data-copy="ss-server-key" title="${t('actions.copy')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                <p class="hint">${t('server.passwordFormat')} <code>${t('server.serverKeyUserKey')}</code></p>
            `;
            }
        } else {
            credentials.innerHTML = `<p class="text-muted">${t('server.dataNotFound')}</p>`;
        }
        
        // Users list - VLESS and Shadowsocks support
        if (state.ssserver.users && state.ssserver.users.length > 0) {
            users.innerHTML = state.ssserver.users.map(user => {
                const userUrl = user.vless_url || user.ss_url;
                const userUrlIp = user.vless_url_ip || user.ss_url_ip;
                const userKey = user.uuid || user.full_password || user.password;
                const keyLabel = user.uuid ? 'UUID:' : t('server.password');
                const urlPrefix = user.vless_url ? 'vless://' : 'ss://';
                
                const isSuspended = user.suspended === true;
                return `
                <div class="user-card ${isSuspended ? 'suspended' : ''}" data-user="${user.name}">
                    <div class="user-header">
                        <span class="user-name">${user.name}</span>
                        <div class="user-actions">
                            <button type="button" class="btn btn-sm ${isSuspended ? 'btn-success' : 'btn-secondary'} btn-suspend" onclick="VPNManager.toggleUserSuspend('${user.name}', ${!isSuspended})" title="${isSuspended ? t('server.activateBtn') : t('server.suspendBtn')}">
                                ${isSuspended ? t('server.activateBtn') : t('server.suspendBtn')}
                            </button>
                            <button type="button" class="btn btn-icon" onclick="VPNManager.openRenameSSUserModal('${user.name}')" title="${t('server.rename')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </button>
                            <button type="button" class="btn btn-icon btn-warning" onclick="VPNManager.regenerateUserKey('${user.name}')" title="${t('server.regenerateKey').replace('{type}', user.uuid ? 'UUID' : 'key')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <polyline points="23 4 23 10 17 10"/>
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                                </svg>
                            </button>
                            <button type="button" class="btn btn-icon btn-danger" onclick="VPNManager.openDeleteSSUserModal('${user.name}')" title="${t('server.deleteUser')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="user-credentials">
                        <div class="credential-row">
                            <label>${keyLabel}</label>
                            <code class="text-truncate" id="user-key-${user.name}">${userKey}</code>
                            <button type="button" class="btn btn-icon btn-copy btn-sm" data-copy="user-key-${user.name}" title="${t('actions.copy')} ${user.uuid ? 'UUID' : t('server.password').replace(':', '')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                </svg>
                            </button>
                        </div>
                        ${userUrl ? `
                        <div class="credential-row">
                            <label>${state.ssserver.detection_method === 'ddns' ? 'DDNS:' : t('server.link')}</label>
                            <code class="text-truncate vpn-url" id="user-url-${user.name}">${userUrl}</code>
                            <button type="button" class="btn btn-icon btn-copy btn-sm" data-copy="user-url-${user.name}" title="${t('server.copyLink')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                </svg>
                            </button>
                            <button type="button" class="btn btn-icon btn-sm" onclick="VPNManager.showQRCode('${userUrl}', '${user.name}')" title="${t('server.showQr')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                    <rect x="3" y="3" width="7" height="7"/>
                                    <rect x="14" y="3" width="7" height="7"/>
                                    <rect x="3" y="14" width="7" height="7"/>
                                    <rect x="14" y="14" width="3" height="3"/>
                                    <rect x="18" y="14" width="3" height="3"/>
                                    <rect x="14" y="18" width="3" height="3"/>
                                    <rect x="18" y="18" width="3" height="3"/>
                                </svg>
                            </button>
                        </div>
                        ` : ''}
                        ${userUrlIp ? `
                        <div class="credential-row">
                            <label>IP:</label>
                            <code class="text-truncate vpn-url" id="user-url-ip-${user.name}">${userUrlIp}</code>
                            <button type="button" class="btn btn-icon btn-copy btn-sm" data-copy="user-url-ip-${user.name}" title="${t('server.copyLink')} (IP)">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                </svg>
                            </button>
                            <button type="button" class="btn btn-icon btn-sm" onclick="VPNManager.showQRCode('${userUrlIp}', '${user.name} (IP)')" title="${t('server.showQr')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                    <rect x="3" y="3" width="7" height="7"/>
                                    <rect x="14" y="3" width="7" height="7"/>
                                    <rect x="3" y="14" width="7" height="7"/>
                                    <rect x="14" y="14" width="3" height="3"/>
                                    <rect x="18" y="14" width="3" height="3"/>
                                    <rect x="14" y="18" width="3" height="3"/>
                                    <rect x="18" y="18" width="3" height="3"/>
                                </svg>
                            </button>
                        </div>
                        ` : ''}
                        ${(userUrl && userUrlIp && state.ssserver.detection_method === 'ddns') ? `
                        <p class="hint user-link-hint">💡 ${t('server.recommendDdns')}</p>
                        ` : ''}
                    </div>
                </div>
            `}).join('');
        } else {
            users.innerHTML = `
                <div class="empty-state">
                    <p class="text-warning"><strong>${t('server.disabled')}</strong></p>
                    <p class="text-muted">${t('server.noUsers')}</p>
                </div>
            `;
        }
        
        // Add copy event listeners with fallback
        initCopyButtons();
    }
    
    // Universal copy function with fallback
    function copyToClipboard(text) {
        // Try modern API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text)
                .then(() => {
                    showToast(t('success.copiedToClipboard'), 'success');
                    return true;
                })
                .catch(() => {
                    // Fallback
                    return copyFallback(text);
                });
        }
        // Fallback for HTTP
        return Promise.resolve(copyFallback(text));
    }
    
    function copyFallback(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        
        try {
            const successful = document.execCommand('copy');
            document.body.removeChild(textarea);
            if (successful) {
                showToast(t('success.copiedToClipboard'), 'success');
                return true;
            } else {
                showToast(t('errors.copyFailed'), 'error');
                return false;
            }
        } catch (err) {
            document.body.removeChild(textarea);
            showToast(t('errors.copyFailed'), 'error');
            return false;
        }
    }
    
    function initCopyButtons() {
        document.querySelectorAll('.btn-copy[data-copy]').forEach(btn => {
            // Remove old handlers (clone element)
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const targetId = newBtn.dataset.copy;
                const target = document.getElementById(targetId);
                if (target) {
                    copyToClipboard(target.textContent.trim());
                }
            });
        });
    }
    
    async function ssserverStart() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/vpnserver.cgi/start`, { method: 'POST' });
            const data = await response.json();
            
            if (response.ok) {
                showToast(data.message || t('server.started'), 'success');
                loadSSServerStatus();
            } else {
                showToast(t(data.error) || t('errors.serverStart'), 'error');
            }
        } catch (error) {
            showToast(t('errors.connection'), 'error');
        }
    }
    
    async function ssserverStop() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/vpnserver.cgi/stop`, { method: 'POST' });
            const data = await response.json();
            
            if (response.ok) {
                showToast(data.message || t('server.stopped'), 'success');
                loadSSServerStatus();
            } else {
                showToast(t(data.error) || t('errors.serverStop'), 'error');
            }
        } catch (error) {
            showToast(t('errors.connection'), 'error');
        }
    }
    
    async function ssserverRestart() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/vpnserver.cgi/restart`, { method: 'POST' });
            const data = await response.json();
            
            if (response.ok) {
                showToast(data.message || t('server.restarted'), 'success');
                loadSSServerStatus();
            } else {
                showToast(t(data.error) || t('errors.serverRestart'), 'error');
            }
        } catch (error) {
            showToast(t('errors.connection'), 'error');
        }
    }
    
    async function addSSUser(name) {
        try {
            console.log('Adding user:', name);
            const response = await fetch(`${CONFIG.API_BASE}/vpnserver.cgi/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await response.json();
            console.log('Add user response:', data);
            
            if (response.ok && data.success !== false) {
                showToast(t('server.userAdded').replace('{name}', name), 'success');
                hideAllModals();
                await loadSSServerStatus();
            } else {
                showToast(t(data.error) || t('errors.serverAdd'), 'error');
            }
        } catch (error) {
            console.error('Add user error:', error);
            showToast(t('errors.connection'), 'error');
        }
    }
    
    function openDeleteSSUserModal(name) {
        const modal = $('#ssuser-delete-modal');
        const nameInput = $('#ssuser-delete-name');
        const displayName = $('#ssuser-delete-display-name');
        
        nameInput.value = name;
        displayName.textContent = name;
        showModal(modal);
    }
    
    async function confirmDeleteSSUser() {
        const name = $('#ssuser-delete-name').value;
        const confirmBtn = $('#ssuser-delete-confirm-btn');
        
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = '...';
        }
        
        try {
            console.log('Deleting user:', name);
            const response = await fetch(`${CONFIG.API_BASE}/vpnserver.cgi/users/${name}`, { method: 'DELETE' });
            const data = await response.json();
            console.log('Delete response:', data);
            
            if (response.ok && data.success !== false) {
                showToast(t('server.userDeleted').replace('{name}', name), 'success');
                hideAllModals();
                await loadSSServerStatus();
            } else {
                showToast(t(data.error) || t('errors.serverDelete'), 'error');
            }
        } catch (error) {
            console.error('Delete user error:', error);
            showToast(t('errors.connection'), 'error');
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = t('modal.delete');
            }
        }
    }
    
    function openRenameSSUserModal(oldName) {
        const modal = $('#ssuser-rename-modal');
        const oldNameInput = $('#ssuser-rename-oldname');
        const newNameInput = $('#ssuser-rename-newname');
        
        oldNameInput.value = oldName;
        newNameInput.value = oldName;
        showModal(modal);
        newNameInput.focus();
        newNameInput.select();
    }
    
    async function confirmRenameSSUser() {
        const oldName = $('#ssuser-rename-oldname').value;
        const newName = $('#ssuser-rename-newname').value.trim();
        const form = $('#ssuser-rename-form');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        if (!newName || newName === oldName) {
            hideAllModals();
            return;
        }
        
        if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
            showToast(t('errors.invalidName'), 'error');
            return;
        }
        
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '...';
        }
        
        try {
            console.log('Renaming user:', oldName, '->', newName);
            const response = await fetch(`${CONFIG.API_BASE}/vpnserver.cgi/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_name: oldName, new_name: newName })
            });
            const data = await response.json();
            console.log('Rename response:', data);
            
            if (response.ok && data.success !== false) {
                showToast(t('server.userRenamed').replace('{old}', oldName).replace('{new}', newName), 'success');
                hideAllModals();
                await loadSSServerStatus();
            } else {
                showToast(t(data.error) || t('errors.serverRename'), 'error');
            }
        } catch (error) {
            console.error('Rename user error:', error);
            showToast(t('errors.connection'), 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = t('modal.save');
            }
        }
    }
    
    async function toggleUserSuspend(name, suspended) {
        const card = document.querySelector(`.user-card[data-user="${name}"]`);
        const btn = card?.querySelector('.btn-suspend');
        if (btn) {
            btn.disabled = true;
            btn.dataset.origText = btn.textContent;
            btn.innerHTML = '<svg class="btn-spinner" viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg>';
            btn.classList.add('spinning');
        }
        try {
            await api('/vpnserver.cgi/suspend', {
                method: 'POST',
                body: JSON.stringify({ name, suspended })
            });
            showToast(suspended ? t('server.userSuspendedMsg').replace('{name}', name) : t('server.userResumedMsg').replace('{name}', name), 'success');
            loadSSServerStatus();
        } catch (err) {
            showToast(err.message || t('errors.unknown'), 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = btn.dataset.origText;
                btn.classList.remove('spinning');
            }
        }
    }
    
    async function regenerateUserKey(name) {
        if (!confirm(t('server.confirmRegenerate').replace('{name}', name))) return;
        
        try {
            const response = await fetch(`${CONFIG.API_BASE}/vpnserver.cgi/regenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await response.json();
            
            if (response.ok) {
                showToast(t('server.credentialsUpdated').replace('{name}', name), 'success');
                loadSSServerStatus();
            } else {
                showToast(t(data.error) || t('errors.serverRegenerate'), 'error');
            }
        } catch (error) {
            showToast(t('errors.connection'), 'error');
        }
    }
    
    function openSSUserModal() {
        const modal = $('#ssuser-modal');
        const form = $('#ssuser-form');
        form.reset();
        showModal(modal);
    }
    
    // ============================================
    // VPN configurations export
    // ============================================

    // Files from the last export, kept so the download buttons can reach their
    // bodies without asking the backend again.
    let exportConfigsFiles = [];

    function showExportConfigsStep(step) {
        const select = $('#export-configs-select');
        const result = $('#export-configs-result');
        const confirmBtn = $('#export-configs-confirm-btn');
        const copyBtn = $('#export-configs-copy-btn');
        const backBtn = $('#export-configs-back-btn');
        const onResult = step === 'result';

        if (select) select.classList.toggle('hidden', onResult);
        if (result) result.classList.toggle('hidden', !onResult);
        if (confirmBtn) confirmBtn.classList.toggle('hidden', onResult);
        if (copyBtn) copyBtn.classList.toggle('hidden', !onResult);
        if (backBtn) backBtn.classList.toggle('hidden', !onResult);
    }

    async function openExportConfigsModal() {
        const modal = $('#export-configs-modal');
        const list = $('#export-configs-list');
        if (!modal || !list) return;

        // Reopening must land on the picker — the modal keeps the previous state.
        showExportConfigsStep('select');
        exportConfigsFiles = [];
        const selectAll = $('#export-configs-selectall');
        if (selectAll) selectAll.checked = true;

        list.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
        showModal(modal);

        try {
            const res = await api('/vpn.cgi/export-list');
            const data = res.data || {};
            const subs = data.subscriptions || [];
            const cfgs = data.configs || [];

            if (!subs.length && !cfgs.length) {
                list.innerHTML = `<div class="empty-state">${t('exportConfigs.nothing')}</div>`;
                return;
            }

            let html = '';
            if (subs.length) {
                html += `<div class="export-group-title">${t('exportConfigs.subscriptions')}</div>`;
                html += subs.map(s => `
                    <label class="checkbox-inline">
                        <input type="checkbox" data-sub-id="${escapeHtml(s.id)}" checked>
                        <span>${escapeHtml(s.name)}
                            <span class="text-muted">(${t('exportConfigs.servers').replace('{n}', s.server_count || 0)})</span>
                        </span>
                    </label>
                `).join('');
            }
            if (cfgs.length) {
                html += `<div class="export-group-title">${t('exportConfigs.standalone')}</div>`;
                html += cfgs.map(c => `
                    <label class="checkbox-inline">
                        <input type="checkbox" data-config-id="${escapeHtml(c.id)}" checked>
                        <span>${escapeHtml(c.name)}
                            <span class="text-muted">(${escapeHtml(c.protocol)}${c.kind === 'file' ? ', ' + t('exportConfigs.asFile') : ''})</span>
                        </span>
                    </label>
                `).join('');
            }
            list.innerHTML = html;
        } catch (error) {
            list.innerHTML = `<div class="error">${t('errors.loading')}</div>`;
        }
    }

    async function confirmExportConfigs() {
        const subIds = Array.from($$('#export-configs-list input[data-sub-id]:checked')).map(cb => cb.dataset.subId);
        const cfgIds = Array.from($$('#export-configs-list input[data-config-id]:checked')).map(cb => cb.dataset.configId);

        if (!subIds.length && !cfgIds.length) {
            showToast(t('exportConfigs.selectAtLeastOne'), 'warning');
            return;
        }

        const params = [];
        if (subIds.length) params.push('subs=' + encodeURIComponent(subIds.join(',')));
        if (cfgIds.length) params.push('configs=' + encodeURIComponent(cfgIds.join(',')));

        try {
            const res = await api('/vpn.cgi/export?' + params.join('&'));
            renderExportConfigsResult(res.data || {});
        } catch (error) {
            showToast(t('errors.loading'), 'error');
        }
    }

    function renderExportConfigsResult(data) {
        const links = data.links || [];
        const files = data.files || [];

        // A comment line above each entry and a blank line between entries, so the
        // block stays readable once pasted into a note.
        const text = links.map(item => {
            const kind = item.kind === 'subscription' ? t('exportConfigs.kindSubscription') : item.protocol;
            return `# ${item.name} — ${kind}\n${item.link}`;
        }).join('\n\n');

        const textarea = $('#export-configs-text');
        if (textarea) textarea.value = text || t('exportConfigs.noLinks');

        exportConfigsFiles = files;
        const filesBlock = $('#export-configs-files');
        const filesList = $('#export-configs-files-list');
        if (filesBlock && filesList) {
            if (files.length) {
                filesList.innerHTML = files.map((f, i) => `
                    <div class="export-file-row">
                        <span>${escapeHtml(f.name)} <span class="text-muted">(${escapeHtml(f.protocol)})</span></span>
                        <button type="button" class="btn btn-secondary btn-sm" data-export-file="${i}">${t('exportConfigs.download')}</button>
                    </div>
                `).join('');
                filesBlock.classList.remove('hidden');
            } else {
                filesList.innerHTML = '';
                filesBlock.classList.add('hidden');
            }
        }

        showExportConfigsStep('result');
    }

    function downloadExportConfigFile(index) {
        const file = exportConfigsFiles[index];
        if (!file) return;

        const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename || 'config.conf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function copyExportConfigsText() {
        const textarea = $('#export-configs-text');
        if (!textarea || !textarea.value) return;

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(textarea.value);
            } else {
                // The panel is served over plain HTTP, where the async clipboard API
                // is not available, so fall back to the legacy selection copy.
                textarea.removeAttribute('readonly');
                textarea.select();
                const ok = document.execCommand('copy');
                textarea.setAttribute('readonly', '');
                textarea.blur();
                if (!ok) throw new Error('execCommand copy rejected');
            }
            showToast(t('exportConfigs.copied'), 'success');
        } catch (error) {
            showToast(t('exportConfigs.copyFailed'), 'warning');
        }
    }

    // ============================================
    // VPN Server Users Export / Import
    // ============================================
    
    async function openExportSSUsersModal() {
        const modal = $('#export-ssusers-modal');
        const list = $('#export-ssusers-list');
        const selectAll = $('#export-ssusers-selectall');
        if (!modal || !list) return;
        
        list.innerHTML = `<div class="loading">${t('common.loading')}</div>`;
        if (selectAll) selectAll.checked = true;
        showModal(modal);
        
        try {
            const data = await api('/vpnserver.cgi');
            // /vpnserver.cgi GET returns the server config object directly,
            // not the {success, data} wrapper used by most endpoints.
            const users = (data && Array.isArray(data.users)) ? data.users
                        : (data && data.data && Array.isArray(data.data.users)) ? data.data.users
                        : [];
            if (!users.length) {
                list.innerHTML = `<div class="empty-state">${t('exportUsers.noUsers')}</div>`;
                return;
            }
            list.innerHTML = users.map(u => `
                <label class="checkbox-inline">
                    <input type="checkbox" data-username="${escapeHtml(u.name)}" checked>
                    <span>${escapeHtml(u.name)}</span>
                </label>
            `).join('');
        } catch (error) {
            list.innerHTML = `<div class="error">${t('errors.loading')}</div>`;
        }
    }
    
    function confirmExportSSUsers() {
        const checked = Array.from($$('#export-ssusers-list input[type="checkbox"][data-username]:checked'));
        if (!checked.length) {
            showToast(t('exportUsers.selectAtLeastOne'), 'warning');
            return;
        }
        const names = checked.map(cb => cb.dataset.username);
        // Use a hidden iframe-style download via window.open of the GET endpoint with query.
        const url = `${CONFIG.API_BASE}/vpnserver.cgi/export?names=${encodeURIComponent(names.join(','))}`;
        // Trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        hideModal($('#export-ssusers-modal'));
        showToast(t('exportUsers.downloadStarted'), 'success');
    }
    
    function openImportSSUsersModal() {
        const modal = $('#import-ssusers-modal');
        if (!modal) return;
        const fileInput = $('#import-ssusers-file');
        if (fileInput) fileInput.value = '';
        const preview = $('#import-ssusers-preview');
        if (preview) {
            preview.classList.add('hidden');
            preview.innerHTML = '';
        }
        const skipRadio = modal.querySelector('input[name="import-ssusers-mode"][value="skip"]');
        if (skipRadio) skipRadio.checked = true;
        // Reset cached parsed file
        modal._parsedPayload = null;
        showModal(modal);
    }
    
    function previewImportSSUsersFile(e) {
        const file = e.target.files && e.target.files[0];
        const preview = $('#import-ssusers-preview');
        const modal = $('#import-ssusers-modal');
        if (!file || !preview || !modal) return;
        
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target.result;
            try {
                const parsed = JSON.parse(text);
                if (parsed.type !== 'vpn-manager-vlessserver-users' || !Array.isArray(parsed.users)) {
                    throw new Error('shape');
                }
                modal._parsedPayload = parsed;
                const usersHtml = parsed.users.slice(0, 20).map(u => `<li>${escapeHtml(u.name || '?')} <span class="muted">${escapeHtml((u.uuid || '').slice(0, 8))}…</span></li>`).join('');
                const more = parsed.users.length > 20 ? `<li>… +${parsed.users.length - 20}</li>` : '';
                preview.innerHTML = `
                    <p><strong>${t('importUsers.previewTitle').replace('{n}', parsed.users.length)}</strong></p>
                    <ul class="import-preview-list">${usersHtml}${more}</ul>
                `;
                preview.classList.remove('hidden');
            } catch (err) {
                modal._parsedPayload = null;
                preview.innerHTML = `<div class="error">${t('importUsers.invalidFile')}</div>`;
                preview.classList.remove('hidden');
            }
        };
        reader.readAsText(file);
    }
    
    async function confirmImportSSUsers() {
        const modal = $('#import-ssusers-modal');
        if (!modal) return;
        const payload = modal._parsedPayload;
        if (!payload) {
            showToast(t('importUsers.pickFile'), 'warning');
            return;
        }
        const modeRadio = modal.querySelector('input[name="import-ssusers-mode"]:checked');
        const mode = modeRadio ? modeRadio.value : 'skip';
        const btn = $('#import-ssusers-confirm-btn');
        const originalText = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="btn-spinner"></span> ${t('common.loading')}`;
        }
        try {
            const body = JSON.stringify({ ...payload, mode });
            const data = await api('/vpnserver.cgi/import', { method: 'POST', body });
            if (data.success) {
                const r = data.data || {};
                const summary = t('importUsers.summary')
                    .replace('{added}', r.added || 0)
                    .replace('{overwritten}', r.overwritten || 0)
                    .replace('{skipped}', r.skipped || 0)
                    .replace('{invalid}', r.invalid || 0);
                showToast(summary, 'success');
                hideModal(modal);
                loadSSServerStatus();
            }
        } catch (error) {
            showToast(t(error.message) || error.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    }

    // ============================================
    // VPN Server Port Management (FEAT-201)
    // ============================================
    
    async function changeServerPort(newPort, btnEl) {
        const btn = btnEl || $('#btn-change-server-port');
        
        if (btn) {
            btn.disabled = true;
            btn.classList.add('btn-loading');
            btn.innerHTML = `<span class="btn-spinner"></span> ${t('settings.restarting')}`;
        }
        
        try {
            const response = await fetch(`${CONFIG.API_BASE}/vpnserver.cgi/change-port`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ port: parseInt(newPort) })
            });
            const data = await response.json();
            
            if (response.ok && data.success !== false) {
                showToast(t('success.serverPortChanged'), 'success');
                await loadSSServerStatus();
            } else {
                showToast(t(data.error) || t('errors.serverPortChange'), 'error');
            }
        } catch (error) {
            console.error('Change server port error:', error);
            showToast(t('errors.connection'), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('btn-loading');
                btn.textContent = t('settings.changePort');
            }
        }
    }

    // ============================================
    // Routing Policies Functions
    // ============================================
    
    // Order here is the order in the dropdown
    const POLICY_LABELS = {
        direct: { icon: '➡️', textKey: 'routing.policy.direct', shortKey: 'routing.policy.direct', hintKey: 'routing.direct' },
        split: { icon: '🔀', textKey: 'routing.policy.split', shortKey: 'routing.policy.split', hintKey: 'routing.split' },
        vpnprimary: { icon: '🛡️', textKey: 'routing.policy.vpnprimary', shortKey: 'routing.policy.vpnprimary', hintKey: 'routing.vpnprimary' },
        fullvpn: { icon: '🔒', textKey: 'routing.policy.fullvpn', shortKey: 'routing.policy.fullvpnShort', hintKey: 'routing.fullvpn' }
    };

    // Translated label for a policy (unknown values fall back to split)
    function policyLabel(policy) {
        const p = POLICY_LABELS[policy] || POLICY_LABELS.split;
        return { icon: p.icon, text: t(p.textKey), short: t(p.shortKey), hint: t(p.hintKey) };
    }

    // Segments data cache
    let cachedSegmentsData = null;
    
    async function loadRoutingTile() {
        try {
            const response = await api('/segments.cgi');
            
            if (!response.segments || response.segments.length === 0) {
                $('#routing-tile')?.classList.add('hidden');
                return;
            }
            
            // Cache data
            cachedSegmentsData = response;
            
            // Collect all segments (br0 first)
            const allSegments = [...response.segments].sort((a, b) => {
                if (a.bridge === 'br0') return -1;
                if (b.bridge === 'br0') return 1;
                return a.index - b.index;
            });
            
            // Add VPN server if exists (sing-box inbound on port 8388)
            if (response.vpn_server) {
                allSegments.push({
                    id: 'vpn-server',
                    name: t('tab.server'),
                    description: t('segments.vpnClients'),
                    bridge: 'vpn_server',
                    subnet: response.vpn_server.port ? `${t('segments.port')} ${response.vpn_server.port}` : `${t('segments.port')} 8388`,
                    policy: response.vpn_server.policy || 'split',
                    isVpnServer: true,
                    isInternal: response.vpn_server.isInternal || false
                });
            }
            
            renderRoutingHeader(allSegments);
            renderRoutingBody(allSegments);
            
            // Check overflow after render
            requestAnimationFrame(() => checkHeaderOverflow());
            
        } catch (error) {
            console.error('Error loading routing tile:', error);
            $('#routing-tile')?.classList.add('hidden');
        }
    }
    
    function renderRoutingHeader(segments) {
        const container = $('#routing-header-segments');
        
        container.innerHTML = segments.map(seg => {
            const policy = policyLabel(seg.policy);
            const name = seg.description || seg.name;
            return `
                <div class="routing-header-badge" data-bridge="${seg.bridge}">
                    <span class="badge-name">${escapeHtml(name)}</span>
                    <span class="badge-policy" data-policy="${seg.policy}">${policy.icon} ${policy.short}</span>
                </div>
            `;
        }).join('');
    }
    
    function renderRoutingBody(segments) {
        const container = $('#routing-tile-segments');
        
        container.innerHTML = segments.map(seg => {
            const name = seg.description || seg.name;
            const iface = seg.isVpnServer ? '' : seg.bridge;
            const wifi = seg.wifi || '';
            const subnet = seg.subnet || '';
            
            return `
                <div class="routing-segment-card" data-bridge="${seg.bridge}">
                    <div class="segment-info">
                        <span class="segment-name">${escapeHtml(name)}</span>
                        <div class="segment-meta">
                            ${iface ? `<span class="segment-interface">${iface}</span>` : ''}
                            ${wifi ? `<span class="segment-wifi">📶 ${escapeHtml(wifi)}</span>` : ''}
                            ${subnet ? `<span class="segment-subnet">${subnet}</span>` : ''}
                        </div>
                    </div>
                    <div class="routing-policy-selector" data-bridge="${seg.bridge}">
                        ${renderPolicySelect(seg.policy)}
                    </div>
                </div>
            `;
        }).join('');

        // Attach handlers to policy dropdowns
        container.querySelectorAll('.policy-select').forEach(select => {
            select.addEventListener('change', handlePolicyChange);
        });
    }

    function renderPolicySelect(currentPolicy) {
        const selected = POLICY_LABELS[currentPolicy] ? currentPolicy : 'split';
        const options = Object.keys(POLICY_LABELS).map(key => {
            const label = policyLabel(key);
            return `<option value="${key}" title="${escapeHtml(label.hint)}"${key === selected ? ' selected' : ''}>${label.icon} ${escapeHtml(label.text)}</option>`;
        }).join('');
        return `<select class="policy-select" data-policy="${selected}" aria-label="${escapeHtml(t('routing.policyLabel'))}" title="${escapeHtml(policyLabel(selected).hint)}">${options}</select>`;
    }

    async function handlePolicyChange(e) {
        const select = e.currentTarget;
        const newPolicy = select.value;
        const bridge = select.closest('.routing-policy-selector').dataset.bridge;
        const policy = policyLabel(newPolicy);

        // Visually update
        select.dataset.policy = newPolicy;
        select.title = policy.hint;

        // Update in header too
        const headerBadge = $(`.routing-header-badge[data-bridge="${bridge}"] .badge-policy`);
        if (headerBadge) {
            headerBadge.dataset.policy = newPolicy;
            headerBadge.innerHTML = `${policy.icon} ${policy.short}`;
        }
        
        // Save to server
        try {
            await saveSegmentPolicy(bridge, newPolicy);
        } catch (error) {
            console.error('Failed to save policy:', error);
            showToast(t('errors.policyFailed'), 'error');
        }
    }
    
    async function saveSegmentPolicy(bridge, policy) {
        // Collect all current policies
        const policies = {};
        $$('.routing-policy-selector').forEach(sel => {
            const br = sel.dataset.bridge;
            const select = sel.querySelector('.policy-select');
            if (select) {
                policies[br] = select.value;
            }
        });
        
        await api('/segments.cgi', {
            method: 'POST',
            body: JSON.stringify({ policies })
        });
        
        showToast(t('success.policyUpdated'), 'success');
    }
    
    function checkHeaderOverflow() {
        const container = $('#routing-header-segments');
        const moreIndicator = $('#routing-header-more');
        const badges = container.querySelectorAll('.routing-header-badge');
        
        if (!container || badges.length === 0) return;
        
        const containerRect = container.getBoundingClientRect();
        let hasHidden = false;
        
        badges.forEach((badge, i) => {
            const badgeRect = badge.getBoundingClientRect();
            // If badge goes beyond container
            if (badgeRect.right > containerRect.right - 30) {
                badge.style.display = 'none';
                hasHidden = true;
            } else {
                badge.style.display = '';
            }
        });
        
        if (moreIndicator) {
            moreIndicator.classList.toggle('hidden', !hasHidden);
        }
    }
    
    function toggleRoutingTile() {
        const tile = $('#routing-tile');
        const body = $('#routing-segments-body');
        
        tile.classList.toggle('expanded');
        body.classList.toggle('hidden');
    }
    
    async function refreshSegmentsCache() {
        const btn = $('#routing-refresh-btn');
        if (btn) {
            btn.disabled = true;
            btn.classList.add('loading');
        }
        
        try {
            await api('/segments.cgi?action=refresh');
            showToast(t('success.segmentsUpdated'), 'success');
            // Reload tile
            await loadRoutingTile();
        } catch (error) {
            console.error('Failed to refresh segments:', error);
            showToast(t('errors.segmentsUpdate'), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('loading');
            }
        }
    }

    // ============================================
    // Donate Functions
    // ============================================
    
    async function loadDonateSettings() {
        try {
            const data = await api('/settings.cgi');
            if (data.success && data.data && data.data.usdt_wallet) {
                state.usdtWallet = data.data.usdt_wallet;
                const donateBtn = $('#donate-btn');
                if (donateBtn) donateBtn.classList.remove('hidden');
            }
        } catch (_) {}
    }
    
    function openDonateModal() {
        if (!state.usdtWallet) return;
        const addressEl = $('#donate-address');
        if (addressEl) addressEl.textContent = state.usdtWallet;
        showModal($('#donate-modal'));
    }
    
    function maybeShowDonateAfterConfig() {
        if (!state.usdtWallet) return;
        try { if (localStorage.getItem('donateShown')) return; } catch (_) {}
        try { localStorage.setItem('donateShown', '1'); } catch (_) {}
        setTimeout(() => openDonateModal(), 500);
    }

    // ============================================
    // Logs Functions
    // ============================================
    
    function openLogsModal() {
        const modal = $('#logs-modal');
        showModal(modal);
        loadLog(state.currentLogName);
    }
    
    async function loadLog(logName) {
        state.currentLogName = logName;
        
        // Update active tab
        $$('.logs-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.log === logName);
        });
        
        const output = $('#logs-output');
        const info = $('#logs-info');
        
        output.textContent = t('logs.loading');
        info.textContent = t('logs.loading');
        
        try {
            const response = await api(`/logs.cgi/${logName}?lines=300`);
            
            if (response.exists === false) {
                output.textContent = t('logs.fileNotExists');
                info.textContent = response.path || '';
                return;
            }
            
            // Decode escape sequences
            let content = response.content || '';
            content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
            
            if (!content.trim()) {
                content = t('logs.empty');
            }
            
            // Highlighting
            content = highlightLogs(content);
            
            output.innerHTML = content;
            
            // Scroll down
            const container = $('#logs-content');
            container.scrollTop = container.scrollHeight;
            
            // Update info
            const sizeKB = Math.round((response.size || 0) / 1024);
            info.textContent = t('logs.info').replace('{path}', response.path).replace('{lines}', response.total_lines || 0).replace('{size}', sizeKB);
            
        } catch (error) {
            output.textContent = t('errors.loading') + ': ' + error.message;
            info.textContent = t('logs.error');
        }
    }
    
    function highlightLogs(content) {
        // Highlight errors and important messages
        return content
            .replace(/\b(ERROR|FATAL|CRITICAL|error|Error)\b/g, '<span class="log-error">$1</span>')
            .replace(/\b(WARN|WARNING|warn|Warning)\b/g, '<span class="log-warning">$1</span>')
            .replace(/\b(INFO|info)\b/g, '<span class="log-info">$1</span>')
            .replace(/\b(SUCCESS|OK|success)\b/g, '<span class="log-success">$1</span>');
    }
    
    async function clearCurrentLog() {
        if (!confirm(t('logs.confirmClear').replace('{name}', state.currentLogName))) return;
        
        try {
            await api(`/logs.cgi/clear/${state.currentLogName}`, { method: 'POST' });
            showToast(t('success.logCleared'), 'success');
            loadLog(state.currentLogName);
        } catch (error) {
            showToast(t('errors.withMessage', {message: error.message}), 'error');
        }
    }
    
    async function clearAllLogs() {
        if (!confirm(t('logs.confirmClearAll'))) return;
        
        try {
            await api('/logs.cgi/clear-all', { method: 'POST' });
            showToast(t('success.allLogsCleared'), 'success');
            loadLog(state.currentLogName);
        } catch (error) {
            showToast(t('errors.withMessage', {message: error.message}), 'error');
        }
    }

    // Export for debugging
    // QR Code Modal
    function showQRCode(url, userName) {
        const modal = $('#qr-modal');
        const title = $('#qr-modal-title');
        const container = $('#qr-modal-canvas');
        const textEl = $('#qr-modal-text');
        
        if (!modal || !container) {
            showToast(t('errors.qrModalNotFound'), 'error');
            return;
        }
        
        title.textContent = `QR-код: ${userName}`;
        container.innerHTML = '';
        if (textEl) textEl.textContent = url;
        
        if (typeof QRCode !== 'undefined') {
            try {
                new QRCode(container, {
                    text: url,
                    width: 256,
                    height: 256,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            } catch (e) {
                container.innerHTML = `<p class="text-error">${t('logs.qrError')}</p>`;
                console.error('QR code generation error:', e);
            }
        } else {
            container.innerHTML = `<p class="text-error">${t('logs.qrLibNotLoaded')}</p>`;
        }
        
        showModal($('#qr-modal'));
    }
    
    // ============================================
    // FEAT-011: Lists Auto-Update
    // ============================================
    
    const listsState = {
        autoUpdateEnabled: true,
        updateInterval: 24,
        lastUpdate: null,
        source: null,
        isUpdating: false
    };
    
    function formatListsSourceDisplay(url) {
        if (!url) return '—';
        try {
            const u = new URL(url);
            if (u.hostname === 'raw.githubusercontent.com' && u.pathname) {
                const parts = u.pathname.replace(/^\/+/, '').split('/');
                if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
            }
            return u.hostname || url;
        } catch (_) {
            return url;
        }
    }
    
    async function loadListsStatus() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/lists.cgi/status`);
            if (!response.ok) return;
            
            const data = await response.json();
            listsState.autoUpdateEnabled = data.auto_update_enabled;
            listsState.updateInterval = data.update_interval;
            listsState.lastUpdate = data.last_update;
            listsState.source = data.source || null;
            
            updateListsTileUI();
        } catch (error) {
            console.error('Failed to load lists status:', error);
        }
    }
    
    function updateScheduleHint(tab, interval) {
        const hint = $(`#lists-schedule-hint-${tab}`);
        if (!hint) return;
        
        const scheduleKey = `autoupdate.schedule${interval}`;
        hint.textContent = t(scheduleKey);
    }
    
    function updateListsTileUI() {
        // Block events during programmatic update
        listsSyncing = true;
        
        // Update both tiles (on Domains and Subnets tabs)
        ['domains', 'subnets'].forEach(tab => {
            const checkbox = $(`#lists-auto-update-checkbox-${tab}`);
            const interval = $(`#lists-interval-select-${tab}`);
            const lastUpdate = $(`#lists-last-update-${tab}`);
            const tile = $(`#lists-auto-update-tile-${tab}`);
            const loader = $(`#lists-update-loader-${tab}`);
            const sourceDisplay = $(`#lists-source-display-${tab}`);
            
            if (checkbox) checkbox.checked = listsState.autoUpdateEnabled;
            if (interval) interval.value = listsState.updateInterval;
            if (sourceDisplay) {
                sourceDisplay.textContent = formatListsSourceDisplay(listsState.source);
                sourceDisplay.title = listsState.source || '';
            }
            
            // Update schedule hint
            updateScheduleHint(tab, listsState.updateInterval);
            
            if (lastUpdate) {
                if (listsState.lastUpdate) {
                    const date = new Date(listsState.lastUpdate);
                    lastUpdate.textContent = `${t('autoupdate.lastUpdate')}: ${date.toLocaleString()}`;
                } else {
                    lastUpdate.textContent = `${t('autoupdate.lastUpdate')}: ${t('autoupdate.never')}`;
                }
            }
            
            if (tile) {
                tile.classList.toggle('disabled', !listsState.autoUpdateEnabled);
                tile.classList.toggle('updating', listsState.isUpdating);
            }
            
            if (loader) {
                loader.classList.toggle('hidden', !listsState.isUpdating);
            }
            
            const refreshBtn = $(`#lists-refresh-btn-${tab}`);
            if (refreshBtn) {
                refreshBtn.classList.toggle('spinning', listsState.isUpdating);
                refreshBtn.disabled = listsState.isUpdating;
            }
        });
        
        // Unblock after UI update
        setTimeout(() => { listsSyncing = false; }, 50);
    }
    
    async function toggleListsAutoUpdate(enabled) {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/lists.cgi/toggle?enabled=${enabled}`);
            
            const data = await response.json();
            
            if (data.success) {
                listsState.autoUpdateEnabled = data.auto_update_enabled;
                updateListsTileUI();
                showToast(enabled ? t('autoupdate.enabledMsg') : t('autoupdate.disabledMsg'), 'success');
                
                // If enabled — start update
                if (enabled) {
                    triggerListsUpdate();
                }
            } else {
                showToast(t(data.error) || t('errors.unknown'), 'error');
            }
        } catch (error) {
            console.error('Toggle lists auto-update error:', error);
            showToast(t('errors.network'), 'error');
        }
    }
    
    async function setListsInterval(interval) {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/lists.cgi/interval?interval=${parseInt(interval)}`);
            
            const data = await response.json();
            
            if (data.success) {
                listsState.updateInterval = data.update_interval;
                updateListsTileUI();
                showToast(t('autoupdate.intervalChanged').replace('{interval}', `${interval}${t('subscription.hours')}`), 'success');
            } else {
                showToast(t(data.error) || t('errors.unknown'), 'error');
            }
        } catch (error) {
            console.error('Set lists interval error:', error);
            showToast(t('errors.network'), 'error');
        }
    }
    
    async function triggerListsUpdate() {
        if (listsState.isUpdating) return;
        
        listsState.isUpdating = true;
        updateListsTileUI();
        
        try {
            const response = await fetch(`${CONFIG.API_BASE}/lists.cgi/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await response.json();
            
            if (data.success) {
                listsState.lastUpdate = data.last_update;
                if (data.domains !== undefined && data.subnets !== undefined) {
                    showToast(t('success.listsUpdated').replace('{domains}', data.domains).replace('{subnets}', data.subnets), 'success');
                } else {
                    showToast(t('success.listsUpdatedShort'), 'success');
                }
                await loadListsStatus();
            } else {
                showToast(data.message || t('autoupdate.updateError'), 'warning');
            }
        } catch (error) {
            console.error('Trigger lists update error:', error);
            showToast(t('errors.network'), 'error');
        } finally {
            listsState.isUpdating = false;
            updateListsTileUI();
        }
    }
    
    // Flag to prevent double calls during sync
    let listsSyncing = false;
    
    function initListsAutoUpdate() {
        // Initialize handlers for both tiles
        ['domains', 'subnets'].forEach(tab => {
            const checkbox = $(`#lists-auto-update-checkbox-${tab}`);
            const interval = $(`#lists-interval-select-${tab}`);
            const refreshBtn = $(`#lists-refresh-btn-${tab}`);
            const viewBtn = $(`#lists-view-btn-${tab}`);
            const transferBtn = $(`#lists-transfer-btn-${tab}`);
            
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    if (listsSyncing) return; // Prevent double call
                    listsSyncing = true;
                    
                    // Sync state between tiles
                    const otherTab = tab === 'domains' ? 'subnets' : 'domains';
                    const otherCheckbox = $(`#lists-auto-update-checkbox-${otherTab}`);
                    if (otherCheckbox) otherCheckbox.checked = e.target.checked;
                    
                    toggleListsAutoUpdate(e.target.checked);
                    
                    setTimeout(() => { listsSyncing = false; }, 100);
                });
            }
            
            if (interval) {
                interval.addEventListener('change', (e) => {
                    if (listsSyncing) return;
                    listsSyncing = true;
                    
                    // Sync between tiles
                    const otherTab = tab === 'domains' ? 'subnets' : 'domains';
                    const otherInterval = $(`#lists-interval-select-${otherTab}`);
                    if (otherInterval) otherInterval.value = e.target.value;
                    
                    // Update schedule hints
                    updateScheduleHint(tab, e.target.value);
                    updateScheduleHint(otherTab, e.target.value);
                    
                    setListsInterval(e.target.value);
                    
                    setTimeout(() => { listsSyncing = false; }, 100);
                });
            }
            
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    triggerListsUpdate();
                });
            }
            
            if (viewBtn) {
                viewBtn.addEventListener('click', () => {
                    openRemoteListsModal();
                });
            }
            
            if (transferBtn) {
                transferBtn.addEventListener('click', () => {
                    openTransferToLocalModal();
                });
            }
        });
        
        // Initialize tabs in modal
        initRemoteListsTabs();
        
        // Wire confirm button for transfer modal (once)
        const transferConfirm = $('#transfer-to-local-confirm-btn');
        if (transferConfirm && !transferConfirm._wired) {
            transferConfirm._wired = true;
            transferConfirm.addEventListener('click', () => confirmTransferToLocal());
        }
        
        // Load status
        loadListsStatus();
    }
    
    // Transfer remote → local: open mode-selection modal
    function openTransferToLocalModal() {
        const modal = $('#transfer-to-local-modal');
        if (!modal) return;
        const scopeText = $('#transfer-to-local-scope-text');
        if (scopeText) {
            scopeText.textContent = t('transferToLocal.scopeAll');
        }
        // Reset radio to default
        const replaceRadio = modal.querySelector('input[name="transfer-mode"][value="replace"]');
        if (replaceRadio) replaceRadio.checked = true;
        showModal(modal);
    }
    
    async function confirmTransferToLocal() {
        const modal = $('#transfer-to-local-modal');
        if (!modal) return;
        const checked = modal.querySelector('input[name="transfer-mode"]:checked');
        const mode = checked ? checked.value : 'replace';
        const btn = $('#transfer-to-local-confirm-btn');
        const originalText = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="btn-spinner"></span> ${t('common.loading')}`;
        }
        try {
            const data = await api('/lists.cgi/transfer', {
                method: 'POST',
                body: JSON.stringify({ kind: 'all', mode })
            });
            if (data.success) {
                hideModal(modal);
                const entries = data.total_entries ?? data.data?.total_entries ?? 0;
                const files = data.files_processed ?? data.data?.files_processed ?? 0;
                showToast(
                    t('transferToLocal.success')
                        .replace('{n}', entries)
                        .replace('{f}', files),
                    'success'
                );
                
                // Reflect: auto-update checkbox is now OFF on both tiles
                ['domains', 'subnets'].forEach(t2 => {
                    const cb = $(`#lists-auto-update-checkbox-${t2}`);
                    if (cb) cb.checked = false;
                });
                listsState.enabled = false;
                updateListsTileUI();
                
                // Reload both editors so user sees the new merged content
                await Promise.all([loadDomains(), loadSubnets()]);
            }
        } catch (error) {
            showToast(t(error.message) || error.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    }
    
    // Remote lists modal tabs
    function initRemoteListsTabs() {
        document.querySelectorAll('[data-remotetab]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.remotetab;
                
                // Deactivate all tabs
                document.querySelectorAll('[data-remotetab]').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.remotetab-content').forEach(c => {
                    c.classList.remove('active');
                    c.classList.add('hidden');
                });
                
                // Activate selected
                btn.classList.add('active');
                const content = $(`#remotetab-${tabId}`);
                if (content) {
                    content.classList.add('active');
                    content.classList.remove('hidden');
                }
            });
        });
    }
    
    // Open remote lists modal
    // Set shown in the viewer: World files in remote-lists/, Russia in remote-lists/direct/
    let remoteListSet = 'world';

    function openRemoteListsModal() {
        // Opens on the set the page is showing; the switch changes it inside the viewer
        remoteListSet = state.listSet === 'russia' ? 'russia' : 'world';
        markListSetSwitch('remote-lists-set', remoteListSet);
        document.querySelectorAll('#remote-lists-set [data-listset]').forEach(btn => {
            if (btn._wired) return;
            btn._wired = true;
            btn.addEventListener('click', () => {
                if (remoteListSet === btn.dataset.listset) return;
                remoteListSet = btn.dataset.listset;
                markListSetSwitch('remote-lists-set', remoteListSet);
                ['tcp-udp-domains', 'udp-domains', 'tcp-udp-subnets', 'udp-subnets'].forEach(id => {
                    const cnt = $(`#remote-${id}-count`);
                    if (cnt) cnt.textContent = '—';
                });
                loadRemoteLists();
            });
        });
        return loadRemoteLists();
    }

    // Fill the viewer with the chosen set's downloaded files
    async function loadRemoteLists() {
        const modal = $('#remote-lists-modal');
        if (!modal) return;
        
        // Show loading
        ['tcp-udp-domains', 'udp-domains', 'tcp-udp-subnets', 'udp-subnets'].forEach(id => {
            const content = $(`#remote-${id}-content`);
            if (content) content.textContent = t('remoteLists.loading');
        });
        
        showModal(modal);
        
        try {
            const listSet = remoteListSet;
            const response = await fetch(withListSet(`${CONFIG.API_BASE}/lists.cgi/files`, listSet));
            if (!response.ok) throw new Error('Failed to load files');
            if (listSet !== remoteListSet) return; // switched to the other set while loading
            
            const data = await response.json();
            
            // Update time
            const updatedEl = $('#remote-lists-updated');
            if (updatedEl) {
                if (data.last_update) {
                    const date = new Date(data.last_update);
                    updatedEl.textContent = `${t('remoteLists.updated')}: ${date.toLocaleString()}`;
                } else {
                    updatedEl.textContent = `${t('remoteLists.updated')}: ${t('autoupdate.never')}`;
                }
            }
            
            // Update source link
            const sourceLink = $('#remote-lists-source-link');
            if (sourceLink && data.source) {
                sourceLink.href = data.source;
                // The Russia set comes from the same source as direct_<file>
                sourceLink.textContent = formatListsSourceDisplay(data.source) + (data.file_prefix ? ` · ${data.file_prefix}*` : '');
                sourceLink.title = data.source;
            }
            
            // Fill content
            const files = data.files;
            
            if (files.tcp_udp_domains) {
                $('#remote-tcp-udp-domains-content').textContent = files.tcp_udp_domains.content || t('lists.empty');
                $('#remote-tcp-udp-domains-count').textContent = files.tcp_udp_domains.count || 0;
            }
            
            if (files.udp_domains) {
                $('#remote-udp-domains-content').textContent = files.udp_domains.content || t('lists.empty');
                $('#remote-udp-domains-count').textContent = files.udp_domains.count || 0;
            }
            
            if (files.tcp_udp_subnets) {
                $('#remote-tcp-udp-subnets-content').textContent = files.tcp_udp_subnets.content || t('lists.empty');
                $('#remote-tcp-udp-subnets-count').textContent = files.tcp_udp_subnets.count || 0;
            }
            
            if (files.udp_subnets) {
                $('#remote-udp-subnets-content').textContent = files.udp_subnets.content || t('lists.empty');
                $('#remote-udp-subnets-count').textContent = files.udp_subnets.count || 0;
            }
            
        } catch (error) {
            console.error('Failed to load remote lists:', error);
            ['tcp-udp-domains', 'udp-domains', 'tcp-udp-subnets', 'udp-subnets'].forEach(id => {
                const content = $(`#remote-${id}-content`);
                if (content) content.textContent = t('errors.loading');
            });
        }
    }
    
    // ============================================
    // IPSet viewer + manual warmup
    // ============================================
    const IPSET_NAMES = [
        'vpn_domains', 'vpn_domains_udp', 'vpn_domains6', 'vpn_domains6_udp',
        'vpn_subnets', 'vpn_subnets_udp', 'vpn_subnets6', 'vpn_subnets6_udp'
    ];
    let _ipsetWarmupPoll = null;
    // Set shown in the viewer: World lists fill the vpn_* ipsets, Russia the direct_* ones.
    // The page keeps the vpn_* element ids as slots for either set.
    let ipsetListSet = 'world';
    const ipsetPrefix = () => (ipsetListSet === 'russia' ? 'direct' : 'vpn');

    // Highlight the chosen set in a list viewer's ruunblockdomains / ruservices switch
    function markListSetSwitch(navId, listSet) {
        document.querySelectorAll(`#${navId} [data-listset]`).forEach(b =>
            b.classList.toggle('active', b.dataset.listset === listSet));
    }

    function resetIpsetView() {
        IPSET_NAMES.forEach(name => {
            const pre = $(`#ipset-content-${name}`);
            if (pre) pre.textContent = t('common.loading');
            const cnt = $(`#ipset-count-${name}`);
            if (cnt) cnt.textContent = '—';
        });
    }

    function initIpsetSetSwitch() {
        document.querySelectorAll('#ipset-set [data-listset]').forEach(btn => {
            if (btn._wired) return;
            btn._wired = true;
            btn.addEventListener('click', () => {
                if (ipsetListSet === btn.dataset.listset) return;
                ipsetListSet = btn.dataset.listset;
                markListSetSwitch('ipset-set', ipsetListSet);
                resetIpsetView();
                loadIpsetStatus();
            });
        });
    }
    
    function initIpsetTabs() {
        document.querySelectorAll('[data-ipsettab]').forEach(btn => {
            if (btn._wired) return;
            btn._wired = true;
            btn.addEventListener('click', () => {
                const name = btn.dataset.ipsettab;
                document.querySelectorAll('[data-ipsettab]').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.ipsettab-content').forEach(c => {
                    c.classList.remove('active');
                    c.classList.add('hidden');
                });
                btn.classList.add('active');
                const pane = $(`#ipsettab-${name}`);
                if (pane) {
                    pane.classList.add('active');
                    pane.classList.remove('hidden');
                }
            });
        });
    }
    
    function openIpsetModal() {
        const modal = $('#ipset-modal');
        if (!modal) return;
        initIpsetTabs();
        initIpsetSetSwitch();
        // Opens on the set the page is showing; the switch changes it inside the viewer
        ipsetListSet = state.listSet === 'russia' ? 'russia' : 'world';
        markListSetSwitch('ipset-set', ipsetListSet);
        resetIpsetView();
        showModal(modal);
        loadIpsetStatus();
    }
    
    async function loadIpsetStatus() {
        try {
            const listSet = ipsetListSet;
            const data = await api(withListSet('/domains.cgi/ipset-status', listSet));
            if (!data.success) throw new Error('failed');
            if (listSet !== ipsetListSet) return; // switched to the other set while loading
            const sets = data.data;
            IPSET_NAMES.forEach(name => {
                // vpn_* slots on the page, the router answers with the chosen set's names
                const info = sets[name.replace(/^vpn/, ipsetPrefix())] || { count: 0, entries: [], exists: false, truncated: false };
                const pre = $(`#ipset-content-${name}`);
                const cnt = $(`#ipset-count-${name}`);
                if (cnt) cnt.textContent = info.count != null ? info.count : 0;
                if (pre) {
                    if (!info.exists) {
                        pre.textContent = t('ipset.notLoaded');
                    } else if (!info.entries || info.entries.length === 0) {
                        pre.textContent = t('lists.empty');
                    } else {
                        let body = info.entries.join('\n');
                        if (info.truncated) {
                            body += `\n\n…${t('ipset.truncated').replace('{n}', sets.max_lines)}`;
                        }
                        pre.textContent = body;
                    }
                }
            });
            
            // Reflect warmup status
            const statusEl = $('#ipset-warmup-status');
            const warmupBtn = $('#ipset-warmup-btn');
            if (sets.warmup_running) {
                if (statusEl) statusEl.textContent = t('ipset.warmupRunning');
                if (warmupBtn) warmupBtn.disabled = true;
                if (!_ipsetWarmupPoll) {
                    _ipsetWarmupPoll = setInterval(loadIpsetStatus, 5000);
                }
            } else {
                if (statusEl && statusEl.textContent === t('ipset.warmupRunning')) {
                    statusEl.textContent = t('ipset.warmupFinished');
                    setTimeout(() => { if (statusEl.textContent === t('ipset.warmupFinished')) statusEl.textContent = ''; }, 5000);
                }
                if (warmupBtn) warmupBtn.disabled = false;
                if (_ipsetWarmupPoll) {
                    clearInterval(_ipsetWarmupPoll);
                    _ipsetWarmupPoll = null;
                }
            }
        } catch (error) {
            IPSET_NAMES.forEach(name => {
                const pre = $(`#ipset-content-${name}`);
                if (pre) pre.textContent = t('errors.loading');
            });
        }
    }
    
    async function triggerIpsetWarmup() {
        const warmupBtn = $('#ipset-warmup-btn');
        const statusEl = $('#ipset-warmup-status');
        try {
            if (warmupBtn) warmupBtn.disabled = true;
            if (statusEl) statusEl.textContent = t('ipset.warmupStarting');
            const data = await api('/domains.cgi/warmup', { method: 'POST', body: JSON.stringify({}) });
            if (data.success) {
                if (statusEl) statusEl.textContent = t('ipset.warmupRunning');
                showToast(t('ipset.warmupStarted'), 'info');
                if (!_ipsetWarmupPoll) {
                    _ipsetWarmupPoll = setInterval(loadIpsetStatus, 5000);
                }
                // Refresh once immediately to pick up warmup_running flag
                setTimeout(loadIpsetStatus, 1000);
            }
        } catch (error) {
            if (warmupBtn) warmupBtn.disabled = false;
            if (statusEl) statusEl.textContent = '';
            showToast(t(error.message) || error.message, 'error');
        }
    }
    
    function initIpsetViewerHandlers() {
        const openBtn = $('#ipset-view-btn');
        if (openBtn && !openBtn._wired) {
            openBtn._wired = true;
            openBtn.addEventListener('click', openIpsetModal);
        }
        const refreshBtn = $('#ipset-refresh-btn');
        if (refreshBtn && !refreshBtn._wired) {
            refreshBtn._wired = true;
            refreshBtn.addEventListener('click', loadIpsetStatus);
        }
        const warmupBtn = $('#ipset-warmup-btn');
        if (warmupBtn && !warmupBtn._wired) {
            warmupBtn._wired = true;
            warmupBtn.addEventListener('click', triggerIpsetWarmup);
        }
        const downloadBtn = $('#ipset-download-btn');
        if (downloadBtn && !downloadBtn._wired) {
            downloadBtn._wired = true;
            downloadBtn.addEventListener('click', downloadIpsetSnapshot);
        }
    }

    function downloadIpsetSnapshot() {
        // Browser handles the file via Content-Disposition header from the CGI.
        // Anchor click is preferred over window.location to keep the modal open.
        const url = withListSet(CONFIG.API_BASE + '/domains.cgi/ipset-export', ipsetListSet);
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 0);
        showToast(t('ipset.downloadStarted'), 'info', 2500);
    }

    window.VPNManager = {
        state,
        loadStatus,
        loadConfigs,
        // loadDevices, — DISABLED
        loadSSServerStatus,
        openDeleteSSUserModal,
        openRenameSSUserModal,
        regenerateUserKey,
        toggleUserSuspend,
        openLogsModal,
        loadLog,
        showQRCode,
        // FEAT-011
        loadListsStatus,
        triggerListsUpdate,
        // i18n + UX bridges for sub-modules (e.g. VPNFailover)
        t,
        showToast
    };
    
    // Call init after page load
    document.addEventListener('DOMContentLoaded', initListsAutoUpdate);
    document.addEventListener('DOMContentLoaded', initIpsetViewerHandlers);
})();

// ============================================
// System Monitor Module
// ============================================
(function() {
    'use strict';
    
    let updateInterval = null;
    const UPDATE_INTERVAL_MS = 5000; // Update every 5 seconds
    
    // Format bytes to human readable
    function formatBytes(mb) {
        if (mb >= 1024) {
            return (mb / 1024).toFixed(1) + ' GB';
        }
        return mb + ' MB';
    }
    
    // Format uptime to human readable
    function formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }
    
    // Update system metrics
    async function updateSystemMetrics() {
        try {
            const response = await fetch('/api/system.cgi');
            if (!response.ok) {
                throw new Error('Failed to fetch system metrics');
            }
            
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Unknown error');
            }
            
            const data = result.data;
            
            // Update CPU - show load average directly
            const cpuValue = document.getElementById('cpu-value');
            const cpuLoad = document.getElementById('cpu-load');
            
            if (cpuValue) {
                // Show load average (1 min) as the main value
                cpuValue.textContent = data.cpu.load1;
            }
            
            if (cpuLoad) {
                cpuLoad.textContent = `load: ${data.cpu.load5}/${data.cpu.load15}`;
            }
            
            // Update Memory
            const memoryValue = document.getElementById('memory-value');
            const memoryDetails = document.getElementById('memory-details');
            
            if (memoryValue) {
                memoryValue.textContent = data.memory.percent + '%';
            }
            
            if (memoryDetails) {
                memoryDetails.textContent = `${data.memory.used} / ${data.memory.total} MB`;
            }
            
            // Update Disk
            const diskValue = document.getElementById('disk-value');
            const diskDetails = document.getElementById('disk-details');
            
            if (diskValue) {
                diskValue.textContent = data.disk.percent + '%';
            }
            
            if (diskDetails) {
                diskDetails.textContent = `${data.disk.used} / ${data.disk.total}`;
            }
            
            // Update Uptime
            const uptimeValue = document.getElementById('uptime-value');
            if (uptimeValue) {
                uptimeValue.textContent = formatUptime(data.uptime);
            }
            
        } catch (error) {
            console.error('Failed to update system metrics:', error);
            ['cpu-value', 'memory-value', 'disk-value', 'uptime-value'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = 'Error';
            });
        }
    }

    
    // Start auto-update
    function startMonitoring() {
        // Initial update
        updateSystemMetrics();
        
        // Set up periodic updates
        if (updateInterval) {
            clearInterval(updateInterval);
        }
        updateInterval = setInterval(updateSystemMetrics, UPDATE_INTERVAL_MS);
    }
    
    // Stop auto-update
    function stopMonitoring() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
    }
    
    // Initialize
    function init() {
        // Toggle collapse/expand - clickable header and button
        const toggleBtn = document.getElementById('toggle-system-monitor');
        const monitorHeader = document.querySelector('#system-monitor-card .status-card-header');
        const monitorBody = document.getElementById('system-monitor-body');
        const chevronIcon = toggleBtn ? toggleBtn.querySelector('.chevron-icon') : null;
        
        const doToggle = () => {
            if (monitorBody) {
                monitorBody.classList.toggle('collapsed');
            }
            if (chevronIcon) {
                chevronIcon.classList.toggle('collapsed');
            }
        };
        
        // Click on button
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                doToggle();
            });
        }
        
        // Click on header (except buttons)
        if (monitorHeader) {
            monitorHeader.style.cursor = 'pointer';
            monitorHeader.addEventListener('click', (e) => {
                // Don't toggle if clicked on a button
                if (!e.target.closest('button')) {
                    doToggle();
                }
            });
        }
        
        const refreshBtn = document.getElementById('refresh-system-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Add spin animation
                refreshBtn.style.transform = 'rotate(360deg)';
                refreshBtn.style.transition = 'transform 0.5s ease';
                setTimeout(() => {
                    refreshBtn.style.transform = '';
                }, 500);
                
                updateSystemMetrics();
            });
        }
        
        // Start monitoring when VPN tab is active
        const vpnTab = document.getElementById('tab-vpn');
        if (vpnTab && vpnTab.classList.contains('active')) {
            startMonitoring();
        }
        
        // Listen for tab changes
        document.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) {
                const tabId = tabBtn.getAttribute('data-tab');
                if (tabId === 'vpn') {
                    startMonitoring();
                } else {
                    stopMonitoring();
                }
            }
        });
        
        // Stop monitoring when page is hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopMonitoring();
            } else {
                const vpnTab = document.getElementById('tab-vpn');
                if (vpnTab && vpnTab.classList.contains('active')) {
                    startMonitoring();
                }
            }
        });
    }

    
    // Initialize after DOM is ready
    document.addEventListener('DOMContentLoaded', init);
    
    // Export for testing
    window.SystemMonitor = {
        update: updateSystemMetrics,
        start: startMonitoring,
        stop: stopMonitoring
    };
})();

// ============================================
// Failover Module (auto-switch VPN configs)
// ============================================
(function() {
    'use strict';
    
    const API_BASE = '/api';
    let pollTimer = null;
    let saving = false;
    
    function $(s) { return document.querySelector(s); }
    
    // i18n bridge: defer to main module's t() if available
    function tr(key, fallback) {
        try {
            if (window.VPNManager && typeof window.VPNManager.t === 'function') {
                const v = window.VPNManager.t(key);
                if (v && v !== key) return v;
            }
        } catch (e) {}
        return fallback || key;
    }
    
    function relativeAgeLabel(sec) {
        if (sec < 60) return sec + tr('time.s', 's') + ' ' + tr('time.ago', 'ago');
        if (sec < 3600) return Math.floor(sec / 60) + tr('time.min', 'min') + ' ' + tr('time.ago', 'ago');
        if (sec < 86400) return Math.floor(sec / 3600) + tr('time.h', 'h') + ' ' + tr('time.ago', 'ago');
        return Math.floor(sec / 86400) + tr('time.d', 'd') + ' ' + tr('time.ago', 'ago');
    }
    
    async function apiCall(path, opts) {
        const res = await fetch(API_BASE + path, {
            credentials: 'same-origin',
            ...opts
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }
    
    function relativeAge(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
        return relativeAgeLabel(sec);
    }
    
    function renderStatus(data) {
        const lastEl = $('#failover-last');
        const histEl = $('#failover-history');
        const modeEl = $('#failover-mode-select');
        const intervalEl = $('#failover-interval-select');
        
        if (modeEl && data.mode) modeEl.value = data.mode;
        if (intervalEl && data.check_interval) intervalEl.value = String(data.check_interval);
        
        const state = data.daemon_state || {};
        if (lastEl) {
            const age = state.last_check_at ? relativeAge(state.last_check_at) : '—';
            const result = state.last_check_result || '—';
            let resultLabel = result;
            if (result === 'ok') resultLabel = tr('failover.statusOk', 'OK');
            else if (result === 'failed') resultLabel = tr('failover.statusFailed', 'FAILED');
            else if (result === 'no-active') resultLabel = tr('failover.noActive', 'no active config');
            const lastLbl = tr('failover.lastCheck', 'Last check');
            lastEl.innerHTML = `${lastLbl}: ${age} — <strong>${resultLabel}</strong>`;
        }
        
        const histSep = document.querySelector('.failover-history-sep');
        if (histEl) {
            const switches = state.switches || [];
            if (switches.length === 0) {
                histEl.textContent = '';
                if (histSep) histSep.style.display = 'none';
            } else {
                const recent = switches.slice(0, 3).map(sw => {
                    const fromLbl = sw.from_label || sw.from || '?';
                    const toLbl   = sw.to_label   || sw.to   || '?';
                    return `${relativeAge(sw.at)}: ${fromLbl} → ${toLbl}`;
                }).join(' · ');
                const recentLbl = tr('failover.recentSwitches', 'Recent switches');
                histEl.innerHTML = `<small>${recentLbl}: ${recent}</small>`;
                if (histSep) histSep.style.display = '';
            }
        }
        
        // Show/hide loader for "settings being saved"
        const loader = $('#failover-loader');
        if (loader) loader.classList.toggle('hidden', !saving);
    }
    
    async function loadStatus() {
        try {
            const data = await apiCall('/failover.cgi/status');
            if (data && (data.mode || data.daemon_state)) {
                // common.sh's json_response wraps differently from json_success — both shapes supported here
                renderStatus(data.success ? (data.data || {}) : data);
            }
        } catch (e) {
            console.warn('failover status load failed', e);
            // Only surface errors when the main UI is visible (user is logged in)
            const mainScreen = document.getElementById('main-screen');
            if (mainScreen && !mainScreen.classList.contains('hidden')) {
                toast(tr('failover.toastError', 'Health check request failed: ') + (e && e.message ? e.message : ''), 'error');
            }
        }
    }
    
    async function saveSettings() {
        const mode = $('#failover-mode-select').value;
        const interval = parseInt($('#failover-interval-select').value, 10);
        saving = true;
        const loader = $('#failover-loader');
        if (loader) loader.classList.remove('hidden');
        try {
            await apiCall('/failover.cgi/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode, check_interval: interval })
            });
            // Restart polling cadence
            schedulePoll();
            await loadStatus();
        } catch (e) {
            console.warn('failover save failed', e);
            toast(tr('failover.toastError', 'Health check request failed: ') + (e && e.message ? e.message : ''), 'error');
        } finally {
            saving = false;
            if (loader) loader.classList.add('hidden');
        }
    }
    
    function toast(msg, type) {
        try {
            if (window.VPNManager && typeof window.VPNManager.showToast === 'function') {
                window.VPNManager.showToast(msg, type || 'info');
            }
        } catch (e) {}
    }
    
    async function manualCheck() {
        const btn = $('#failover-check-btn');
        const loader = $('#failover-loader');
        const originalHtml = btn ? btn.innerHTML : '';
        
        if (btn) {
            btn.disabled = true;
            btn.classList.add('btn-loading');
            btn.innerHTML = `<span class="btn-spinner"></span> ${tr('failover.checking', 'Checking…')}`;
        }
        if (loader) loader.classList.remove('hidden');
        
        try {
            const data = await apiCall('/failover.cgi/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}'
            });
            // Response shape: raw status JSON (not wrapped)
            const status = data && (data.success !== undefined ? data.data || {} : data);
            renderStatus(status);
            
            const result = (status.daemon_state && status.daemon_state.last_check_result) || '';
            if (result === 'ok') {
                toast(tr('failover.toastOk', 'VPN is healthy'), 'success');
            } else if (result === 'failed') {
                toast(tr('failover.toastFailed', 'VPN unreachable'), 'error');
            } else if (result === 'no-active') {
                toast(tr('failover.toastNoActive', 'No active VPN config'), 'warning');
            } else {
                toast(tr('failover.toastDone', 'Check completed'), 'info');
            }
        } catch (e) {
            console.warn('failover check failed', e);
            toast(tr('failover.toastError', 'Check failed: ') + (e && e.message ? e.message : ''), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('btn-loading');
                btn.innerHTML = originalHtml;
            }
            if (loader) loader.classList.add('hidden');
        }
    }
    
    function schedulePoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        // Poll status every 30s while VPN tab is visible
        pollTimer = setInterval(() => {
            const vpnTab = document.getElementById('tab-vpn');
            if (vpnTab && vpnTab.classList.contains('active') && !document.hidden) {
                loadStatus();
            }
        }, 30000);
    }
    
    let wired = false;
    
    function init() {
        const tile = $('#failover-tile');
        if (!tile) return;
        
        if (!wired) {
            wired = true;
            const modeEl = $('#failover-mode-select');
            const intervalEl = $('#failover-interval-select');
            const checkBtn = $('#failover-check-btn');
            
            if (modeEl) modeEl.addEventListener('change', saveSettings);
            if (intervalEl) intervalEl.addEventListener('change', saveSettings);
            if (checkBtn) checkBtn.addEventListener('click', manualCheck);
            
            schedulePoll();
            
            // Reload status when switching to VPN tab
            document.addEventListener('click', (e) => {
                const tabBtn = e.target.closest('[data-tab="vpn"]');
                if (tabBtn) loadStatus();
            });
        }
        
        // Apply i18n to failover controls (options, labels) — safe to repeat
        if (window.VPNManager && typeof window.VPNManager.t === 'function') {
            tile.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                el.textContent = window.VPNManager.t(key);
            });
            tile.querySelectorAll('[data-i18n-title]').forEach(el => {
                const key = el.getAttribute('data-i18n-title');
                el.title = window.VPNManager.t(key);
            });
        }
    }
    
    document.addEventListener('DOMContentLoaded', init);
    
    window.VPNFailover = { reload: loadStatus, check: manualCheck, init };
})();