#!/usr/bin/env node

/**
 * Komari-Agent-NodeJS
 * 项目Github：https://github.com/DsTansice/Komari-Agent-NodeJS
 * 作者博客：https://blog.qfff.de
 * 使用请修改71行主控网址及72行Token参数，当然也可以环境变量里设置
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const http = require('http');
const https = require('https');
const net = require('net');
const url = require('url');


let si, pty, WebSocket, fetch;

try {
    si = require('systeminformation');
} catch (e) {
    console.error('请先安装 systeminformation: npm install systeminformation');
    process.exit(1);
}

try {
    pty = require('node-pty');
} catch (e) {
    console.error('请先安装 node-pty: npm install node-pty');
    process.exit(1);
}

try {
    WebSocket = require('ws');
} catch (e) {
    console.error('请先安装 ws: npm install ws');
    process.exit(1);
}

// 优先使用 Node.js 内置的 fetch (Node.js 18+ 包括 24)
if (typeof globalThis.fetch === 'function') {
    fetch = globalThis.fetch;
    console.log('[INFO] 使用 Node.js 内置 fetch API');
} 
// 回退到 node-fetch (旧版本 Node.js)
else {
    try {
        const nodeFetch = require('node-fetch');
        fetch = nodeFetch.default || nodeFetch;
        console.log('[INFO] 使用 node-fetch 包');
    } catch (e) {
        console.error('错误: 无法找到 fetch 实现');
        console.error('请使用 Node.js 18+ 或安装 node-fetch: npm install node-fetch');
        process.exit(1);
    }
}


const execAsync = util.promisify(exec);

const VERSION = 'komari-agent-nodejs-1.1.2';

// ==================== 配置解析 ====================

function parseEnvArgs() {
    return {
        httpServer: process.env.KOMARI_HTTP_SERVER || '改成你的主控端网站',
        token: process.env.KOMARI_TOKEN || '改成你的Token',
        interval: parseFloat(process.env.KOMARI_INTERVAL || '5.0'),
        reconnectInterval: parseInt(process.env.KOMARI_RECONNECT_INTERVAL || '10'),
        ignoreUnsafeCert: (process.env.KOMARI_IGNORE_UNSAFE_CERT || 'true').toLowerCase() !== 'false',
        logLevel: parseInt(process.env.KOMARI_LOG_LEVEL || '0'),
        disableRemoteControl: (process.env.KOMARI_DISABLE_REMOTE_CONTROL || 'false').toLowerCase() === 'true'
    };
}

function parseArgs() {
    const args = {
        httpServer: null,
        token: null,
        interval: null,
        reconnectInterval: null,
        ignoreUnsafeCert: null,
        logLevel: null,
        disableRemoteControl: null
    };

    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if ((arg === '--http-server' || arg === '-e') && i + 1 < argv.length) {
            args.httpServer = argv[i + 1];
            i++;
        } else if ((arg === '--token' || arg === '-t') && i + 1 < argv.length) {
            args.token = argv[i + 1];
            i++;
        } else if (arg === '--interval' && i + 1 < argv.length) {
            args.interval = parseFloat(argv[i + 1]);
            i++;
        } else if (arg === '--log-level' && i + 1 < argv.length) {
            args.logLevel = parseInt(argv[i + 1]);
            i++;
        } else if (arg === '--disable-web-ssh') {
            args.disableRemoteControl = true;
        } else if (arg === '--help' || arg === '-h') {
            showHelp();
            process.exit(0);
        }
    }

    return args;
}

function mergeConfig(cliConfig, envConfig) {
    const merged = { ...envConfig };
    for (const [key, value] of Object.entries(cliConfig)) {
        if (value !== null) {
            merged[key] = value;
        }
    }
    return merged;
}

function getFinalConfig() {
    const cliConfig = parseArgs();
    const envConfig = parseEnvArgs();
    const config = mergeConfig(cliConfig, envConfig);

    if (!config.httpServer) {
        console.error('错误: 必须提供 --http-server 参数或设置 KOMARI_HTTP_SERVER 环境变量');
        showHelp();
        process.exit(1);
    }

  
    if (typeof config.httpServer === 'string') {
        config.httpServer = config.httpServer.replace(/\/+$/, '');
    }

    if (!config.token) {
        console.error('错误: 必须提供 --token 参数或设置 KOMARI_TOKEN 环境变量');
        showHelp();
        process.exit(1);
    }

    return config;
}

function showHelp() {
    console.log(VERSION);
    console.log();
    console.log('用法: node index.js --token <token> [选项]');
    console.log();
    console.log('选项:');
    console.log('  -e,--http-server <url>     服务器地址 (也可通过 KOMARI_HTTP_SERVER 环境变量设置) (必须)');
    console.log('  -t,--token <token>          认证令牌 (也可通过 KOMARI_TOKEN 环境变量设置) (必须)');
    console.log('  --interval <sec>            实时数据上报间隔 (默认: 5.0秒，可通过 KOMARI_INTERVAL 环境变量设置)');
    console.log('  --log-level <level>         日志级别: 0=关闭Debug日志, 1=基本信息, 2=WebSocket传输，3=终端日志，4网络统计日志，5磁盘统计日志');
    console.log('  --disable-web-ssh           禁用远程控制功能 (远程执行和终端)');
    console.log('  --help                      显示此帮助信息');
    console.log();
    console.log('环境变量配置:');
    console.log('  所有命令行参数均可通过环境变量设置，环境变量优先级低于命令行参数。');
}

// ==================== 日志处理器 ====================

class Logger {
    static _logLevel = 0;

    static setLogLevel(level) {
        this._logLevel = level;
    }

    static _log(message, level = 'INFO') {
        if (this._logLevel === 0 && level !== 'ERROR') return;

        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const logMessage = `[${timestamp}] [${level}] ${message}`;
        console.log(logMessage);

        if (level === 'ERROR') {
            console.error(logMessage);
        }
    }

    static debug(message, debugLevel = 1) {
        if (this._logLevel === debugLevel) {
            this._log(message, 'DEBUG');
        }
    }

    static info(message) {
        this._log(message, 'INFO');
    }

    static warning(message) {
        this._log(message, 'WARNING');
    }

    static error(message) {
        this._log(message, 'ERROR');
    }
}

// ==================== 系统信息收集器 ====================

class SystemInfoCollector {
    constructor() {
        this.lastNetworkStats = { rx: 0, tx: 0 };
        this.totalNetworkUp = 0;
        this.totalNetworkDown = 0;
        this.lastNetworkTime = Date.now();
        this._cpuInitialized = false;
        this._lastCpuUsage = null;
    }

    async getBasicInfo() {
        const [osInfo, cpuInfo, memInfo, diskInfo, networkInfo] = await Promise.all([
            si.osInfo(),
            si.cpu(),
            si.mem(),
            si.fsSize(),
            si.networkInterfaces()
        ]);

        const [ipv4, ipv6] = await Promise.all([
            this._getPublicIpV4().catch(() => null),
            this._getPublicIpV6().catch(() => null)
        ]);

        const osName = osInfo.distro && osInfo.distro !== 'unknown' 
            ? `${osInfo.distro} ${osInfo.release}` 
            : os.type();

        const totalDisk = diskInfo.reduce((sum, disk) => sum + (disk.size || 0), 0);

        const info = {
            arch: os.arch(),
            cpu_cores: cpuInfo.cores || os.cpus().length,
            cpu_name: cpuInfo.brand || 'Unknown CPU',
            disk_total: totalDisk,
            gpu_name: '', // systeminformation 支持 GPU 检测但需要额外配置
            ipv4: ipv4,
            ipv6: ipv6,
            mem_total: memInfo.total || os.totalmem(),
            os: osName,
            kernel_version: osInfo.kernel || os.release(),
            swap_total: memInfo.swaptotal || 0,
            version: VERSION,
            virtualization: await this._getVirtualization()
        };

        Logger.debug(`基础信息数据: ${JSON.stringify(info, null, 2)}`, 1);
        return info;
    }

    async getRealtimeInfo() {
        const [cpuUsage, memInfo, diskInfo, networkStats, processes] = await Promise.all([
            this._getCpuUsage(),
            si.mem(),
            si.fsSize(),
            this._getNetworkStats(),
            si.processes().catch(() => ({ all: 0 }))
        ]);

        // 使用 Node.js 内置的 os.loadavg() 获取系统负载 (Linux/macOS)
        // Windows 下返回 [0, 0, 0]
        const loadavg = os.loadavg();

        const diskTotal = diskInfo.reduce((sum, disk) => sum + (disk.size || 0), 0);
        const diskUsed = diskInfo.reduce((sum, disk) => sum + (disk.used || 0), 0);

        const [tcpConns, udpConns] = await Promise.all([
            this._getTcpConnections().catch(() => 0),
            this._getUdpConnections().catch(() => 0)
        ]);

        const info = {
            cpu: { usage: cpuUsage },
            ram: {
                total: memInfo.total || os.totalmem(),
                used: memInfo.used || (memInfo.total - memInfo.free)
            },
            swap: {
                total: memInfo.swaptotal || 0,
                used: memInfo.swapused || 0
            },
            load: {
                load1: Math.round(loadavg[0] * 100) / 100,
                load5: Math.round(loadavg[1] * 100) / 100,
                load15: Math.round(loadavg[2] * 100) / 100
            },
            disk: {
                total: diskTotal,
                used: diskUsed
            },
            network: {
                up: networkStats.up,
                down: networkStats.down,
                totalUp: networkStats.total_up,
                totalDown: networkStats.total_down
            },
            connections: {
                tcp: tcpConns,
                udp: udpConns
            },
            uptime: Math.floor(os.uptime()),
            process: processes.all || 0,
            message: ''
        };

        Logger.debug(`实时监控数据: ${JSON.stringify(info, null, 2)}`, 2);
        return info;
    }

    async _getCpuUsage() {
        if (!this._cpuInitialized) {
            // 第一次调用，初始化
            this._lastCpuUsage = process.cpuUsage();
            await this._sleep(100); // 等待100ms
            this._cpuInitialized = true;
            return 0.0;
        }

        const newUsage = process.cpuUsage(this._lastCpuUsage);
        this._lastCpuUsage = process.cpuUsage();
        
        // 计算 CPU 使用率 (user + system time / elapsed time)
        const totalUsage = (newUsage.user + newUsage.system) / 1000; // 转换为毫秒
        const percentage = Math.min(100, Math.max(0, totalUsage / 10)); // 简化计算
        
        // 使用 systeminformation 获取更准确的 CPU 使用率
        const currentLoad = await si.currentLoad().catch(() => null);
        if (currentLoad && typeof currentLoad.currentLoad === 'number') {
            return Math.round(currentLoad.currentLoad * 100) / 100;
        }

        return Math.round(percentage * 100) / 100;
    }

    async _getNetworkStats() {
        try {
            const networkStats = await si.networkStats();
            const currentTime = Date.now();

            let totalCurrentRx = 0;
            let totalCurrentTx = 0;

            // 排除虚拟网卡
            const excludePatterns = ['lo', 'docker', 'veth', 'br-', 'tun', 'virbr', 'vmnet'];
            
            for (const iface of networkStats) {
                if (excludePatterns.some(pattern => iface.iface && iface.iface.includes(pattern))) {
                    Logger.debug(`排除虚拟网卡: ${iface.iface}`, 4);
                    continue;
                }
                
                Logger.debug(`统计物理网卡 ${iface.iface}: RX=${iface.rx_bytes}, TX=${iface.tx_bytes}`, 4);
                totalCurrentRx += iface.rx_bytes || 0;
                totalCurrentTx += iface.tx_bytes || 0;
            }

            // 第一次运行
            if (this.lastNetworkStats.rx === 0) {
                Logger.debug(`第一次网络统计，初始化总流量: 下载=${totalCurrentRx}, 上传=${totalCurrentTx}`, 4);
                this.totalNetworkDown = totalCurrentRx;
                this.totalNetworkUp = totalCurrentTx;
                this.lastNetworkStats = { rx: totalCurrentRx, tx: totalCurrentTx };
                this.lastNetworkTime = currentTime;

                return { up: 0, down: 0, total_up: this.totalNetworkUp, total_down: this.totalNetworkDown };
            }

            const timeDiff = (currentTime - this.lastNetworkTime) / 1000; // 转换为秒
            let downSpeed = 0;
            let upSpeed = 0;

            if (timeDiff > 0) {
                downSpeed = Math.max(0, (totalCurrentRx - this.lastNetworkStats.rx) / timeDiff);
                upSpeed = Math.max(0, (totalCurrentTx - this.lastNetworkStats.tx) / timeDiff);
            }

            this.totalNetworkDown = totalCurrentRx;
            this.totalNetworkUp = totalCurrentTx;

            Logger.debug(`网络统计: 下载速度=${Math.floor(downSpeed)} B/s, 上传速度=${Math.floor(upSpeed)} B/s, 总下载=${this.totalNetworkDown}, 总上传=${this.totalNetworkUp}`, 4);

            this.lastNetworkStats = { rx: totalCurrentRx, tx: totalCurrentTx };
            this.lastNetworkTime = currentTime;

            return {
                up: Math.floor(upSpeed),
                down: Math.floor(downSpeed),
                total_up: this.totalNetworkUp,
                total_down: this.totalNetworkDown
            };

        } catch (e) {
            Logger.debug(`网络统计失败: ${e.message}`, 4);
            return { up: 0, down: 0, total_up: 0, total_down: 0 };
        }
    }

    async _getTcpConnections() {
        try {
            const connections = await si.networkConnections();
            return connections.filter(conn => conn.protocol === 'tcp' && conn.state === 'ESTABLISHED').length;
        } catch (e) {
            return 0;
        }
    }

    async _getUdpConnections() {
        try {
            const connections = await si.networkConnections();
            return connections.filter(conn => conn.protocol === 'udp').length;
        } catch (e) {
            return 0;
        }
    }

    async _getVirtualization() {
        try {
            const systemInfo = await si.system();
            if (systemInfo.virtual) {
                return systemInfo.virtualHost || 'Unknown';
            }

            // 检查 Docker
            if (fs.existsSync('/.dockerenv')) {
                return 'Docker';
            }

            // 检查 cgroup
            if (fs.existsSync('/proc/1/cgroup')) {
                const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
                if (cgroup.includes('docker')) return 'Docker';
                if (cgroup.includes('lxc')) return 'LXC';
            }

            // 检查 CPU 信息
            if (fs.existsSync('/proc/cpuinfo')) {
                const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
                if (cpuinfo.includes('QEMU') || cpuinfo.includes('KVM')) return 'QEMU';
            }

            return 'None';
        } catch (e) {
            return 'None';
        }
    }

    async _getPublicIpV4() {
        const services = [
            'https://api.ipify.org',
            'https://icanhazip.com',
            'https://checkip.amazonaws.com',
            'https://ifconfig.me/ip'
        ];

        for (const service of services) {
            try {
                const response = await fetch(service, { 
                    timeout: 5000,
                    headers: { 'User-Agent': VERSION }
                });
                if (response.ok) {
                    const ip = (await response.text()).trim();
                    if (this._isValidIpv4(ip)) return ip;
                }
            } catch (e) {
                continue;
            }
        }
        return null;
    }

    async _getPublicIpV6() {
        const services = [
            'https://api6.ipify.org',
            'https://icanhazip.com'
        ];

        for (const service of services) {
            try {
                const response = await fetch(service, { 
                    timeout: 5000,
                    headers: { 'User-Agent': VERSION }
                });
                if (response.ok) {
                    const ip = (await response.text()).trim();
                    if (this._isValidIpv6(ip)) return ip;
                }
            } catch (e) {
                continue;
            }
        }
        return null;
    }

    _isValidIpv4(ip) {
        const parts = ip.split('.');
        return parts.length === 4 && parts.every(part => {
            const num = parseInt(part, 10);
            return num >= 0 && num <= 255 && part === num.toString();
        });
    }

    _isValidIpv6(ip) {
        return /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(ip) ||
               /^([0-9a-fA-F]{1,4}:){1,7}:$/.test(ip) ||
               /^([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$/.test(ip) ||
               /^([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$/.test(ip) ||
               /^([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$/.test(ip) ||
               /^([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$/.test(ip) ||
               /^([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$/.test(ip) ||
               /^[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})$/.test(ip) ||
               /^:((:[0-9a-fA-F]{1,4}){1,7}|:)$/.test(ip) ||
               /^fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}$/.test(ip) ||
               /^::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])$/.test(ip) ||
               /^([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])$/.test(ip);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== 终端会话处理器 ====================

class TerminalSessionHandler {
    constructor() {
        this.process = null;
        this.heartbeatTimeout = null;
        this.lastHeartbeat = 0;
        this.HEARTBEAT_TIMEOUT = 30000; // 30秒
    }

    async cleanup() {
        Logger.info('执行终端资源清理...');

        if (this.process) {
            try {
                this.process.kill();
                this.process = null;
            } catch (e) {
                Logger.debug(`清理进程失败: ${e.message}`);
            }
        }
    }

    async startSession(requestId, server, token) {
        const log = (msg) => Logger.info(`[终端会话 ${requestId}] ${msg}`);

        log('启动终端会话');

        try {
            const terminalUrl = server.replace('http', 'ws') + `/api/clients/terminal?token=${token}&id=${requestId}`;
            log(`连接终端 WebSocket: ${terminalUrl}`);

            const ws = new WebSocket(terminalUrl);

            await new Promise((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
                setTimeout(() => reject(new Error('连接超时')), 10000);
            });

            log('终端 WebSocket 连接成功');
            await this._runTerminal(ws, requestId, log);

        } catch (e) {
            if (e.message && e.message.includes('ConnectionClosed')) {
                log('[终端会话] 客户端连接已断开 (未收到关闭帧)');
            } else {
                log(`终端会话异常: ${e.message}`);
            }
        } finally {
            await this.cleanup();
            log(`[终端会话] 资源清理完毕: ${requestId}`);
        }
    }

    async _runTerminal(websocket, requestId, log) {
        try {
            const shell = process.env.SHELL || '/bin/bash';
            const env = { ...process.env };
            delete env.PROMPT_COMMAND;

            this.process = pty.spawn(shell, [], {
                name: 'xterm-color',
                cols: 80,
                rows: 24,
                cwd: process.env.PWD || process.cwd(),
                env: env
            });

            log(`终端进程已启动 (PID: ${this.process.pid})`);

            // 处理 PTY 输出到 WebSocket
            this.process.on('data', (data) => {
                if (websocket.readyState === WebSocket.OPEN) {
                    websocket.send(data);
                }
            });

            this.process.on('exit', (code) => {
                log(`终端进程退出，代码: ${code}`);
                if (websocket.readyState === WebSocket.OPEN) {
                    websocket.close();
                }
            });

            // 处理 WebSocket 输入到 PTY
            websocket.on('message', (data) => {
                // 数据可能是字符串或 Buffer
                const message = data.toString();

                try {
                    // 尝试解析为 JSON（控制消息）
                    const parsed = JSON.parse(message);

                    // 处理控制消息
                    if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
                        this.process.resize(parsed.cols, parsed.rows);
                        log(`调整终端大小: ${parsed.cols}x${parsed.rows}`);
                        return;
                    }

                    if (parsed.type === 'input' && parsed.data) {
                        // 输入数据，解码后写入 PTY
                        const inputData = Buffer.from(parsed.data, 'base64').toString();
                        this.process.write(inputData);
                        log(`收到终端输入，长度: ${inputData.length} 字符`);
                        return;
                    }

                    if (parsed.type === 'heartbeat') {
                        // 心跳消息，忽略
                        return;
                    }

                    // 其他未知类型的 JSON 消息，忽略
                    log(`收到未知控制消息类型: ${parsed.type}`);

                } catch (e) {
                    // 不是有效的 JSON，视为原始终端输入（向后兼容）
                    this.process.write(message);
                }
            });

            websocket.on('close', () => {
                log('WebSocket 连接关闭');
                this.process.kill();
            });

            // 等待进程结束
            await new Promise((resolve) => {
                this.process.on('exit', resolve);
                websocket.on('close', resolve);
            });

        } catch (e) {
            log(`启动终端失败: ${e.message}`);
            await this.cleanup();
        }
    }
}

// ==================== 事件处理器 ====================

class EventHandler {
    constructor(config, disableRemoteControl = false) {
        this.config = config;
        this.disableRemoteControl = disableRemoteControl;
    }

    async handleEvent(event) {
        const messageType = event.message || '';

        Logger.info(`收到服务器事件: ${messageType}`);
        Logger.debug(`事件详情: ${JSON.stringify(event, null, 2)}`, 2);

        switch (messageType) {
            case 'exec':
                await this._handleRemoteExec(event);
                break;
            case 'ping':
                await this._handlePingTask(event);
                break;
            case 'terminal':
                await this._handleTerminal(event);
                break;
            default:
                Logger.warning(`未知的事件类型: ${messageType}`);
        }
    }

    async _handleRemoteExec(event) {
        if (this.disableRemoteControl) {
            Logger.warning('远程执行功能已被禁用，忽略任务');
            return;
        }

        const taskId = event.task_id || '';
        const command = event.command || '';

        if (!taskId || !command) {
            Logger.error('远程执行任务缺少必要参数: task_id 或 command');
            return;
        }

        if (this._isDangerousCommand(command)) {
            Logger.warning(`检测到可能危险的命令，拒绝执行: ${command}`);
            await this._reportExecResult(taskId, '命令被拒绝执行：安全检查未通过', -3);
            return;
        }

        Logger.info(`执行远程命令: ${command}`);
        await this._executeCommand(taskId, command);
    }

    _isDangerousCommand(command) {
        const dangerousPatterns = [
            'rm -rf /', 'dd if=', ':(){ :|:& };:', 'reboot', 'poweroff'
        ];
        const commandLower = command.toLowerCase();
        return dangerousPatterns.some(pattern => commandLower.includes(pattern));
    }

    async _executeCommand(taskId, command) {
        const startTime = Date.now();

        try {
            const isWindows = os.platform() === 'win32';
            const shellCmd = isWindows 
                ? ['powershell', '-Command', command]
                : ['sh', '-c', command];

            Logger.info(`执行命令: ${shellCmd.join(' ')}`);

            const child = spawn(shellCmd[0], shellCmd.slice(1), {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            const timeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('TIMEOUT')), 30000);
            });

            const execution = new Promise((resolve) => {
                child.on('close', (code) => {
                    resolve(code);
                });
            });

            let exitCode;
            try {
                exitCode = await Promise.race([execution, timeout]);
            } catch (e) {
                if (e.message === 'TIMEOUT') {
                    Logger.warning('命令执行超时，强制终止进程');
                    child.kill();
                    await this._reportExecResult(taskId, '命令执行超时（30秒）', -2);
                    return;
                }
                throw e;
            }

            const executionTime = (Date.now() - startTime) / 1000;
            let output = stdout;
            if (stderr) {
                if (output) output += '\n=== STDERR ===\n';
                output += stderr;
            }

            Logger.info(`命令执行完成，耗时: ${executionTime.toFixed(2)}s, 退出码: ${exitCode}`);

            if (output.length > 10000) {
                output = output.substring(0, 10000) + `\n... (输出被截断，总长度: ${output.length} 字符)`;
            }
            if (!output) output = '无输出结果';

            await this._reportExecResult(taskId, output, exitCode || 0);

        } catch (e) {
            Logger.error(`命令执行异常: ${e.message}`);
            await this._reportExecResult(taskId, `命令执行异常: ${e.message}`, -1);
        }
    }

    async _reportExecResult(taskId, result, exitCode) {
        const reportUrl = `${this.config.httpServer}/api/clients/task/result?token=${this.config.token}`;
        
        const reportData = {
            task_id: taskId,
            result: result,
            exit_code: exitCode,
            finished_at: new Date().toISOString()
        };

        Logger.debug(`上报执行结果: ${JSON.stringify(reportData, null, 2)}`, 2);

        try {
            const response = await fetch(reportUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reportData)
            });

            if (response.status === 200 || response.status === 201) {
                Logger.info('执行结果上报成功');
            } else {
                const errorBody = await response.text();
                Logger.error(`执行结果上报失败 - HTTP: ${response.status}, 响应: ${errorBody}`);
            }
        } catch (e) {
            Logger.error(`执行结果上报异常: ${e.message}`);
        }
    }

    async _handlePingTask(event) {
        const taskId = event.ping_task_id || '';
        const pingType = event.ping_type || '';
        const target = event.ping_target || '';

        if (!taskId || !pingType || !target) {
            Logger.error('网络探测任务缺少必要参数');
            return;
        }

        Logger.info(`执行网络探测: ${pingType} -> ${target}`);
        await this._executePing(taskId, pingType, target);
    }

    async _executePing(taskId, pingType, target) {
        try {
            let latency = -1;

            switch (pingType) {
                case 'icmp':
                    latency = await this._pingIcmp(target);
                    break;
                case 'tcp':
                    latency = await this._pingTcp(target);
                    break;
                case 'http':
                    latency = await this._pingHttp(target);
                    break;
                default:
                    Logger.error(`不支持的探测类型: ${pingType}`);
                    return;
            }

            await this._reportPingResult(taskId, pingType, latency);

        } catch (e) {
            Logger.error(`网络探测异常: ${e.message}`);
            await this._reportPingResult(taskId, pingType, -1);
        }
    }

    async _pingIcmp(target) {
        try {
            const isWindows = os.platform() === 'win32';
            const command = isWindows 
                ? `ping -n 1 ${target}`
                : `ping -c 1 -W 1 ${target}`;

            const startTime = Date.now();
            const { stdout } = await execAsync(command, { timeout: 5000 });
            const elapsed = Date.now() - startTime;

            if (isWindows) {
                const match = stdout.match(/时间[=<](\d+)ms/);
                if (match) return parseFloat(match[1]);
            } else {
                const match = stdout.match(/time=([\d.]+)\s*ms/);
                if (match) return parseFloat(match[1]);
            }

            return elapsed;
        } catch (e) {
            return -1;
        }
    }

    async _pingTcp(target) {
        try {
            const [host, portStr] = target.includes(':') ? target.split(':') : [target, '80'];
            const port = parseInt(portStr, 10);

            const startTime = Date.now();
            await new Promise((resolve, reject) => {
                const socket = new net.Socket();
                socket.setTimeout(3000);
                socket.once('connect', () => {
                    socket.destroy();
                    resolve();
                });
                socket.once('error', reject);
                socket.once('timeout', () => {
                    socket.destroy();
                    reject(new Error('timeout'));
                });
                socket.connect(port, host);
            });

            return Date.now() - startTime;
        } catch (e) {
            return -1;
        }
    }

    async _pingHttp(target) {
        try {
            const url = target.startsWith('http') ? target : `http://${target}`;
            const startTime = Date.now();
            await fetch(url, { timeout: 5000 });
            return Date.now() - startTime;
        } catch (e) {
            return -1;
        }
    }

    async _reportPingResult(taskId, pingType, value) {
        const resultData = {
            type: 'ping_result',
            task_id: parseInt(taskId),
            ping_type: pingType,
            value: value,
            finished_at: new Date().toISOString()
        };

        Logger.debug(`上报网络探测结果: ${JSON.stringify(resultData, null, 2)}`, 2);
        // 注意：这里需要通过 WebSocket 上报，在主监控循环中实现
    }

    async _handleTerminal(event) {
        if (this.disableRemoteControl) {
            Logger.warning('远程终端功能已被禁用，忽略请求');
            return;
        }

        const requestId = event.request_id || '';
        if (!requestId) {
            Logger.error('终端连接请求缺少 request_id');
            return;
        }

        Logger.info(`建立终端连接: ${requestId}`);
        this._startTerminalSession(requestId);
    }

    async _startTerminalSession(requestId) {
        const log = (msg) => Logger.info(`[终端会话] ${msg}`);

        log(`启动终端会话: ${requestId}`);

        try {
            const handler = new TerminalSessionHandler();
            await handler.startSession(
                requestId,
                this.config.httpServer,
                this.config.token
            );
        } catch (e) {
            log(`启动终端会话失败: ${e.message}`);
        }
    }
}

// ==================== 主监控客户端 ====================

class KomariMonitorClient {
    constructor(config) {
        this.config = config;
        this.disableRemoteControl = config.disableRemoteControl || false;
        this.systemInfo = new SystemInfoCollector();
        this.eventHandler = new EventHandler(config, this.disableRemoteControl);
        this.lastBasicInfoReport = 0;
        this.BASIC_INFO_INTERVAL = 300000; // 5分钟
        this.ws = null;
        this.sequence = 0;
        this.monitoringInterval = null;
    }

    async run() {
        Logger.info('启动 Komari 监控客户端 (Node.js 版本)');
        if (this.disableRemoteControl) {
            Logger.info('远程控制功能已禁用');
        }

        while (true) {
            try {
                await this._runMonitoringCycle();
                await this._sleep(this.config.reconnectInterval * 1000);
            } catch (e) {
                Logger.error(`监控周期出错: ${e.message}`);
                Logger.info(`${this.config.reconnectInterval}秒后重试...`);
                await this._sleep(this.config.reconnectInterval * 1000);
            }
        }
    }

    async _runMonitoringCycle() {
        const basicInfoUrl = `${this.config.httpServer}/api/clients/uploadBasicInfo?token=${this.config.token}`;
        const wsUrl = this.config.httpServer.replace('http', 'ws') + `/api/clients/report?token=${this.config.token}`;

        // 启动时立即上报基础信息
        await this._pushBasicInfo(basicInfoUrl);

        // 启动 WebSocket 监控
        await this._startWebsocketMonitoring(wsUrl, basicInfoUrl);
    }

    async _pushBasicInfo(url) {
        const basicInfo = await this.systemInfo.getBasicInfo();

        Logger.info('基础信息上报数据:');
        Logger.info(JSON.stringify(basicInfo, null, 2));

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(basicInfo)
            });

            if (response.status === 200 || response.status === 201) {
                Logger.info('基础信息推送成功');
                this.lastBasicInfoReport = Date.now();
                return true;
            } else {
                Logger.error(`基础信息推送失败 - HTTP: ${response.status}`);
                return false;
            }
        } catch (e) {
            Logger.error(`基础信息推送异常: ${e.message}`);
            return false;
        }
    }

    async _startWebsocketMonitoring(wsUrl, basicInfoUrl) {
        Logger.debug(`启动 WebSocket 监控: ${wsUrl}`, 2);

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                Logger.info('WebSocket 连接成功，开始监控');
                this._startMonitoringLoop(basicInfoUrl);
            });

            this.ws.on('message', async (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    Logger.debug(`收到服务器消息: ${JSON.stringify(event, null, 2)}`, 2);
                    await this.eventHandler.handleEvent(event);
                } catch (e) {
                    Logger.error(`处理WebSocket消息异常: ${e.message}`);
                }
            });

            this.ws.on('close', () => {
                Logger.info('WebSocket 连接关闭');
                this._stopMonitoringLoop();
                resolve();
            });

            this.ws.on('error', (e) => {
                Logger.error(`WebSocket 监控异常: ${e.message}`);
                reject(e);
            });
        });
    }

    _startMonitoringLoop(basicInfoUrl) {
        const interval = Math.max(100, this.config.interval * 1000);

        this.monitoringInterval = setInterval(async () => {
            try {
                // 检查是否需要上报基础信息（5分钟一次）
                const currentTime = Date.now();
                if (currentTime - this.lastBasicInfoReport >= this.BASIC_INFO_INTERVAL) {
                    const success = await this._pushBasicInfo(basicInfoUrl);
                    if (success) {
                        this.lastBasicInfoReport = currentTime;
                    } else {
                        // 如果推送失败，等待30秒后重试
                        this.lastBasicInfoReport = currentTime - this.BASIC_INFO_INTERVAL + 30000;
                    }
                }

                // 获取并发送实时监控数据
                const realtimeInfo = await this.systemInfo.getRealtimeInfo();
                Logger.debug(`准备发送实时数据: ${JSON.stringify(realtimeInfo, null, 2)}`, 2);

                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify(realtimeInfo));
                    this.sequence++;
                    Logger.debug(`第 ${this.sequence} 条数据发送成功`, 2);
                }
            } catch (e) {
                Logger.error(`发送监控数据失败: ${e.message}`);
                this._stopMonitoringLoop();
            }
        }, interval);
    }

    _stopMonitoringLoop() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== 环境检查 ====================

async function checkEnvironment() {
    Logger.info('正在检查运行环境...');

    const errors = [];
    const warnings = [];

    // 检查 Node.js 版本
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion < 14) {
        errors.push('需要 Node.js 14 或更高版本');
    } else {
        Logger.info(`✅ Node.js 版本: ${nodeVersion}`);
    }

    // 检查必要模块
    const requiredModules = [
        ['systeminformation', 'systeminformation'],
        ['node-pty', 'node-pty'],
        ['ws', 'ws']
    ];

    for (const [moduleName, packageName] of requiredModules) {
        try {
            require(packageName);
            Logger.info(`✅ 模块 ${moduleName} 可用`);
        } catch (e) {
            errors.push(`缺少必要模块: ${moduleName}，请运行: npm install ${packageName}`);
        }
    }

    // 检查系统命令
    if (os.platform() !== 'win32') {
        try {
            await execAsync('which ping');
            Logger.info('✅ 系统命令 ping 可用');
        } catch (e) {
            warnings.push('缺少系统命令: ping，部分功能可能受限');
        }
    }

    if (warnings.length > 0) {
        Logger.warning('\n⚠️  警告:');
        warnings.forEach(w => Logger.warning(`   - ${w}`));
    }

    if (errors.length > 0) {
        Logger.error('\n❌ 环境检查失败，发现以下问题:');
        errors.forEach(e => Logger.error(`   - ${e}`));
        return false;
    }

    Logger.info('✅ 环境检查通过，所有依赖项均可用');
    return true;
}

// ==================== 主函数 ====================

async function main() {
    try {
        const config = getFinalConfig();

        if (await checkEnvironment()) {
            Logger.setLogLevel(config.logLevel);
            const client = new KomariMonitorClient(config);
            await client.run();
        } else {
            process.exit(1);
        }

    } catch (e) {
        if (e.name === 'Error' && e.message && e.message.includes('用户中断')) {
            Logger.info('程序被用户中断');
        } else {
            Logger.error(`程序异常: ${e.message}`);
            process.exit(1);
        }
    }
}

// 处理 Ctrl+C
process.on('SIGINT', () => {
    Logger.info('程序被用户中断');
    process.exit(0);
});

process.on('SIGTERM', () => {
    Logger.info('程序被终止');
    process.exit(0);
});

main();
