

const fs = require('fs');
const path = require('path');
const { Client } = require('discord.js-selfbot-v13');
const { Client: BotClient, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
const axios = require('axios');
const initSqlJs = require('sql.js');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const DB_PATH = path.join(__dirname, 'discord_data.db');
let db = null;

async function initDb() {
    if (!fs.existsSync(DB_PATH)) {
        logErr('DB', `Veritabani bulunamadi: ${DB_PATH}`);
        return false;
    }
    try {
        const SQL = await initSqlJs();
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        const res = db.exec('SELECT count(*) as c FROM discord_data');
        const count = res[0].values[0][0];
        logOk('DB', `Veritabani yuklendi: ${DB_PATH}`);
        logOk('DB', `${count} kayit mevcut`);
        return true;
    } catch (e) {
        logErr('DB', `Veritabani hatasi: ${e.message}`);
        return false;
    }
}

function dbQuery(sql, params) {
    if (!db) return [];
    try {
        const stmt = db.prepare(sql);
        if (params) stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    } catch (e) {
        return [];
    }
}

function lookupUser(discordId) {
    if (!db) return null;
    const rows = dbQuery('SELECT discord_id, email, ip_address FROM discord_data WHERE discord_id = ?', [discordId]);
    if (rows.length === 0) return null;
    let emails = [];
    let ips = [];
    for (const row of rows) {
        if (row.email && String(row.email).length > 0) emails.push(String(row.email));
        if (row.ip_address && String(row.ip_address).length > 0) ips.push(String(row.ip_address));
    }
    emails = [...new Set(emails)];
    ips = [...new Set(ips)];
    return { emails, ips, found: true };
}

function lookupUserExtended(discordId) {
    if (!db) return null;
    const base = lookupUser(discordId);
    if (!base) return null;

    const userRows = dbQuery('SELECT email, ip_address FROM users WHERE discord_id = ?', [discordId]);
    for (const row of userRows) {
        if (row.email && String(row.email).length > 0) base.emails.push(String(row.email));
        if (row.ip_address && String(row.ip_address).length > 0) base.ips.push(String(row.ip_address));
    }
    base.emails = [...new Set(base.emails)];
    base.ips = [...new Set(base.ips)];

    const siteRows = dbQuery('SELECT email, ip_address FROM site_logins WHERE discord_id = ?', [discordId]);
    for (const row of siteRows) {
        if (row.email && String(row.email).length > 0) base.emails.push(String(row.email));
        if (row.ip_address && String(row.ip_address).length > 0) base.ips.push(String(row.ip_address));
    }
    base.emails = [...new Set(base.emails)];
    base.ips = [...new Set(base.ips)];

    return base;
}

const badgeDefinitions = {
    PremiumEarlySupporter: { name: 'Early Supporter', emoji: '<:early:1234>', rarity: 50 },
    HypeSquadEvents: { name: 'HypeSquad Events', emoji: '<:hse:1234>', rarity: 70 },
    Partner: { name: 'Partner', emoji: '<:partner:1234>', rarity: 80 },
    BugHunterLevel1: { name: 'Bug Hunter 1', emoji: '<:bh1:1234>', rarity: 90 },
    BugHunterLevel2: { name: 'Bug Hunter 2', emoji: '<:bh2:1234>', rarity: 100 },
    VerifiedDeveloper: { name: 'Early Bot Dev', emoji: '<:ebd:1234>', rarity: 60 },
    CertifiedModerator: { name: 'Certified Mod', emoji: '<:cm:1234>', rarity: 100 },
    Staff: { name: 'Discord Staff', emoji: '<:staff:1234>', rarity: 100 },
    ActiveDeveloper: { name: 'Active Developer', emoji: '<:ad:1234>', rarity: 30 },
};

const flagMapping = {
    'ActiveDeveloper': ['ACTIVE_DEVELOPER', 'ActiveDeveloper'],
    'PremiumEarlySupporter': ['EARLY_SUPPORTER', 'PremiumEarlySupporter'],
    'HypeSquadEvents': ['HYPESQUAD_EVENTS', 'HypeSquadEvents'],
    'BugHunterLevel1': ['BUG_HUNTER_LEVEL_1', 'BugHunterLevel1'],
    'BugHunterLevel2': ['BUG_HUNTER_LEVEL_2', 'BugHunterLevel2'],
    'VerifiedDeveloper': ['VERIFIED_BOT_DEVELOPER', 'VerifiedDeveloper'],
    'CertifiedModerator': ['CERTIFIED_MODERATOR', 'CertifiedModerator'],
    'Staff': ['STAFF', 'Staff'],
    'Partner': ['PARTNER', 'Partner'],
};

const activeBadges = [
    'PremiumEarlySupporter',
    'HypeSquadEvents',
    'VerifiedDeveloper',
    'Partner',
    'BugHunterLevel1',
    'BugHunterLevel2',
    'CertifiedModerator',
    'Staff',
    'ActiveDeveloper',
];

function log(tag, msg) {
    const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false });
    console.log(`\x1b[36m[${ts}]\x1b[0m \x1b[33m[${tag}]\x1b[0m ${msg}`);
}

function logOk(tag, msg) {
    const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false });
    console.log(`\x1b[36m[${ts}]\x1b[0m \x1b[32m[${tag}]\x1b[0m ${msg}`);
}

function logErr(tag, msg) {
    const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false });
    console.log(`\x1b[36m[${ts}]\x1b[0m \x1b[31m[${tag}]\x1b[0m ${msg}`);
}

async function sendWebhook(data) {
    if (!config.webhook_url || config.webhook_url === 'WEBHOOK_URL_BURAYA') return;
    try {
        await axios.post(config.webhook_url, data);
    } catch (e) {
        logErr('WEBHOOK', `Gonderilemedi: ${e.message}`);
    }
}

async function sendBadgeWebhook(user, badges, guildName, dataInfo) {
    const badgeNames = badges.map(b => badgeDefinitions[b]?.name || b).join(', ');
    const fields = [
        { name: 'Kullanici', value: `${user.tag} (<@${user.id}>)`, inline: true },
        { name: 'ID', value: user.id, inline: true },
        { name: 'Rozetler', value: badgeNames, inline: false },
        { name: 'Sunucu', value: guildName, inline: true },
    ];

    if (dataInfo) {
        if (dataInfo.emails.length > 0) {
            fields.push({ name: 'E-posta', value: dataInfo.emails.join('\n').slice(0, 1024), inline: false });
        }
        if (dataInfo.ips.length > 0) {
            fields.push({ name: 'IP', value: dataInfo.ips.join('\n').slice(0, 1024), inline: false });
        }
    }

    const embed = {
        title: 'Badge Bulundu!',
        color: dataInfo ? 0xff6600 : 0x00ff00,
        fields,
        thumbnail: { url: user.displayAvatarURL({ dynamic: true, size: 128 }) },
        footer: { text: 'Ozturk Badge Scanner v2.0' },
        timestamp: new Date().toISOString(),
    };
    await sendWebhook({ embeds: [embed] });
}

async function sendSummaryWebhook(guildName, totalMembers, totalBadges, elapsed, badgeCounts, dataStats) {
    let desc = `**${guildName}** taramasi tamamlandi!\n\n`;
    desc += `Taranan: **${totalMembers}** uye\n`;
    desc += `Badge bulunan: **${totalBadges}** uye\n`;
    desc += `Sure: **${elapsed}s**\n\n`;

    if (dataStats) {
        desc += '**Data Eslesmesi:**\n';
        desc += `> DB\'de bulunan: **${dataStats.totalInDb}** uye\n`;
        desc += `> E-postasi olan: **${dataStats.withEmail}** uye\n`;
        desc += `> IP\'si olan: **${dataStats.withIp}** uye\n`;
        desc += `> Badge + Data: **${dataStats.badgeWithData}** uye\n\n`;
    }

    if (Object.keys(badgeCounts).length > 0) {
        desc += '**Badge Dagilimi:**\n';
        for (const [badge, count] of Object.entries(badgeCounts)) {
            const name = badgeDefinitions[badge]?.name || badge;
            desc += `> ${name}: **${count}**\n`;
        }
    }

    const embed = {
        title: 'Tarama Tamamlandi',
        description: desc.slice(0, 4096),
        color: 0x5865F2,
        footer: { text: 'Ozturk Badge Scanner v2.0' },
        timestamp: new Date().toISOString(),
    };
    await sendWebhook({ content: '||@everyone||', embeds: [embed] });
}

function extractFlags(user, member) {
    let flags = [];
    try {
        const userObj = member?.user || user;
        if (userObj?.flags) {
            if (typeof userObj.flags.toArray === 'function') flags = userObj.flags.toArray();
            else if (Array.isArray(userObj.flags)) flags = userObj.flags;
        }
        if (userObj?.publicFlags) {
            let pf = [];
            if (typeof userObj.publicFlags.toArray === 'function') pf = userObj.publicFlags.toArray();
            else if (Array.isArray(userObj.publicFlags)) pf = userObj.publicFlags;
            flags = [...new Set([...flags, ...pf])];
        }
        if (userObj?.flags?.bitfield !== undefined) {
            const bf = userObj.flags.bitfield;
            if (bf & 1) flags.push('STAFF');
            if (bf & 2) flags.push('PARTNER');
            if (bf & 4) flags.push('HYPESQUAD_EVENTS');
            if (bf & 8) flags.push('BUG_HUNTER_LEVEL_1');
            if (bf & 512) flags.push('EARLY_SUPPORTER');
            if (bf & 16384) flags.push('BUG_HUNTER_LEVEL_2');
            if (bf & 131072) flags.push('VERIFIED_BOT_DEVELOPER');
            if (bf & 262144) flags.push('CERTIFIED_MODERATOR');
            if (bf & 4194304) flags.push('ACTIVE_DEVELOPER');
            flags = [...new Set(flags)];
        }
    } catch (e) {}
    return flags;
}

function scanUser(user, member) {
    const flags = extractFlags(user, member);
    const found = [];
    for (const badgeKey of activeBadges) {
        const flagNames = flagMapping[badgeKey];
        if (flagNames) {
            for (const fn of flagNames) {
                if (flags.includes(fn)) { found.push(badgeKey); break; }
            }
        }
    }
    return { hasBadges: found.length > 0, badges: found, flags };
}

async function fetchAllMembers(guild) {
    log('FETCH', `${guild.name} (${guild.memberCount} uye) uyeleri cekiliyor...`);
    let members = new Map();

    try {
        log('FETCH', 'Uyeler cekiliyor...');
        const fetched = await Promise.race([
            guild.members.fetch(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 180000))
        ]);
        if (fetched && fetched.size > 0) {
            fetched.forEach((m, id) => members.set(id, m));
            logOk('FETCH', `${members.size}/${guild.memberCount} uye cekildi`);
        }

        if (members.size < guild.memberCount * 0.95) {
            log('FETCH', 'Chunked fetch deneniyor...');
            let lastId = null;
            if (members.size > 0) {
                const sorted = Array.from(members.values()).sort((a, b) => a.user.id.localeCompare(b.user.id));
                lastId = sorted[sorted.length - 1].user.id;
            }
            let attempts = 0;
            while (attempts < 100) {
                try {
                    const opts = { limit: 1000 };
                    if (lastId) opts.after = lastId;
                    const chunk = await Promise.race([
                        guild.members.fetch(opts),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 15000))
                    ]);
                    if (!chunk || chunk.size === 0) break;
                    const before = members.size;
                    chunk.forEach((m, id) => members.set(id, m));
                    if (members.size === before) break;
                    lastId = Array.from(chunk.values())[chunk.size - 1].user.id;
                    attempts++;
                    if (chunk.size < 1000) break;
                } catch (e) {
                    break;
                }
            }
            logOk('FETCH', `Toplam ${members.size} uye cekildi`);
        }
    } catch (e) {
        logErr('FETCH', `Uye cekme hatasi: ${e.message}`);
    }

    logOk('FETCH', `Toplam ${members.size}/${guild.memberCount} uye cekildi`);
    return members;
}

async function processGuild(guild, sendIndividualWebhooks = true) {
    log('SCAN', `${guild.name} (${guild.memberCount} uye) taraniyor...`);
    const startTime = Date.now();

    const members = await fetchAllMembers(guild);
    if (members.size === 0) {
        logErr('SCAN', 'Hic uye cekilemedi!');
        return null;
    }

    const memberArray = Array.from(members.values());
    const allBadgeUsers = [];
    const badgeCounts = {};
    let processed = 0;

    const dataStats = { withEmail: 0, withIp: 0, badgeWithData: 0 };

    for (const member of memberArray) {
        if (member.user.bot) continue;
        processed++;

        const result = scanUser(member.user, member);

        if (result.hasBadges) {
            const badgeNames = result.badges.map(b => badgeDefinitions[b]?.name || b).join(', ');
            const dataInfo = lookupUserExtended(member.user.id);

            if (dataInfo) {
                dataStats.badgeWithData++;
                if (dataInfo.emails.length > 0) dataStats.withEmail++;
                if (dataInfo.ips.length > 0) dataStats.withIp++;
            }

            allBadgeUsers.push({
                tag: member.user.tag,
                id: member.user.id,
                badges: result.badges,
                badgeNames,
                avatar: member.user.displayAvatarURL({ dynamic: true }),
                dataInfo,
            });

            for (const b of result.badges) {
                badgeCounts[b] = (badgeCounts[b] || 0) + 1;
            }

            if (sendIndividualWebhooks) {
                await sendBadgeWebhook(member.user, result.badges, guild.name, dataInfo);
            }

            const dataTag = dataInfo ? ` [${dataInfo.emails.join(', ')} | ${dataInfo.ips.join(', ')}]` : '';
            logOk('BADGE', `${member.user.tag} — ${badgeNames}${dataTag}`);
        }

        if (processed % 1000 === 0) {
            log('SCAN', `${processed}/${memberArray.length} tarandi | badge: ${allBadgeUsers.length}`);
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    logOk('DONE', `Tarama bitti! ${allBadgeUsers.length} badge'li uye, ${elapsed}s`);
    if (dataStats.badgeWithData > 0) {
        logOk('DATA', `Badge+Data: ${dataStats.badgeWithData} uye | ${dataStats.withEmail} email | ${dataStats.withIp} ip`);
    }

    await sendSummaryWebhook(guild.name, processed, allBadgeUsers.length, elapsed, badgeCounts, db ? dataStats : null);

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = path.join(__dirname, 'sonuclar');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    let txt = '';
    txt += `╔══════════════════════════════════════════════════════════════╗\n`;
    txt += `║           OZTURK BADGE SCANNER v2.0 - SONUCLAR             ║\n`;
    txt += `╚══════════════════════════════════════════════════════════════╝\n\n`;
    txt += `Sunucu: ${guild.name}\n`;
    txt += `Tarih: ${new Date().toLocaleString('tr-TR')}\n`;
    txt += `Taranan: ${processed} | Cekildi: ${members.size}/${guild.memberCount}\n`;
    txt += `Badge bulunan: ${allBadgeUsers.length} | Sure: ${elapsed}s\n`;
    txt += `${'='.repeat(62)}\n\n`;

    if (db && dataStats.badgeWithData > 0) {
        txt += `Badge + Data: ${dataStats.badgeWithData} uye (${dataStats.withEmail} email, ${dataStats.withIp} ip)\n`;
        txt += `${'='.repeat(62)}\n\n`;
    }

    txt += `--- BADGE SONUCLARI ---\n\n`;
    for (const [badge, count] of Object.entries(badgeCounts)) {
        txt += `--- ${badgeDefinitions[badge]?.name || badge} (${count}) ---\n`;
        const users = allBadgeUsers.filter(u => u.badges.includes(badge));
        for (const u of users) {
            let line = `  ${u.tag} | ${u.id}`;
            if (u.dataInfo) {
                if (u.dataInfo.emails.length > 0) line += ` | email: ${u.dataInfo.emails.join(', ')}`;
                if (u.dataInfo.ips.length > 0) line += ` | ip: ${u.dataInfo.ips.join(', ')}`;
            }
            txt += line + '\n';
        }
        txt += '\n';
    }

    const badgeWithData = allBadgeUsers.filter(u => u.dataInfo);
    if (badgeWithData.length > 0) {
        txt += `\n${'='.repeat(62)}\n`;
        txt += `--- BADGE + DATA ESLESEN UYELER (${badgeWithData.length}) ---\n\n`;
        for (const u of badgeWithData) {
            txt += `  ${u.tag} | ${u.id} | ${u.badgeNames}\n`;
            if (u.dataInfo.emails.length > 0) txt += `    Email: ${u.dataInfo.emails.join(', ')}\n`;
            if (u.dataInfo.ips.length > 0) txt += `    IP: ${u.dataInfo.ips.join(', ')}\n`;
            txt += '\n';
        }
    }

    const safeName = guild.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(outDir, `${safeName}_${dateStr}.txt`);
    fs.writeFileSync(filePath, txt, 'utf8');
    logOk('SAVE', `Kaydedildi: ${path.basename(filePath)}`);

    if (badgeWithData.length > 0) {
        let csv = 'discord_id,username,badges,emails,ips\n';
        for (const u of badgeWithData) {
            csv += `${u.id},"${u.tag}","${u.badgeNames}","${(u.dataInfo?.emails || []).join(' | ')}","${(u.dataInfo?.ips || []).join(' | ')}"\n`;
        }
        const csvPath = path.join(outDir, `${safeName}_data_${dateStr}.csv`);
        fs.writeFileSync(csvPath, csv, 'utf8');
        logOk('SAVE', `CSV kaydedildi: ${path.basename(csvPath)}`);
    }

    return { allBadgeUsers, processed, totalFound: allBadgeUsers.length, elapsed, badgeCounts, dataStats };
}

function showBanner() {
    console.clear();
    console.log('\x1b[36m');
    console.log('  ╔══════════════════════════════════════════════════════════╗');
    console.log('  ║            OZTURK BADGE SCANNER v2.0                    ║');
    console.log('  ║         Badge Tarama + Data Karsilastirma               ║');
    console.log('  ╚══════════════════════════════════════════════════════════╝');
    console.log('\x1b[0m');
}

async function runStandalone() {
    showBanner();
    const hasDb = await initDb();
    if (hasDb) {
        logOk('MODE', 'Data karsilastirma AKTIF');
    } else {
        log('MODE', 'Data karsilastirma PASIF (discord_data.db bulunamadi)');
    }

    const token = config.selfbot_token;
    const guildId = config.target_guild_id;

    if (!token || token === 'SELFBOT_TOKEN_BURAYA') {
        logErr('CONFIG', 'config.json\'da selfbot_token gir!');
        process.exit(1);
    }

    log('LOGIN', 'Giris yapiliyor...');
    const client = new Client({ checkUpdate: false });

    client.on('ready', async () => {
        logOk('LOGIN', `${client.user.tag} olarak giris yapildi`);
        logOk('INFO', `${client.guilds.cache.size} sunucuda uye`);

        if (guildId) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
                await processGuild(guild, true);
            } else {
                logErr('GUILD', `Sunucu bulunamadi: ${guildId}`);
            }
        } else {
            log('INFO', 'Tum sunucular taraniyor...');
            for (const [, guild] of client.guilds.cache) {
                if (guild.memberCount > 250000) {
                    log('SKIP', `${guild.name} (${guild.memberCount} uye) — cok buyuk, atlaniyor`);
                    continue;
                }
                if (guild.memberCount > 10) {
                    await processGuild(guild, false);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }

        logOk('DONE', 'Tum taramalar bitti!');
        if (db) db.close();
        client.destroy();
        process.exit(0);
    });

    client.login(token).catch(e => {
        logErr('LOGIN', `Giris hatasi: ${e.message}`);
        process.exit(1);
    });
}

async function runBot() {
    showBanner();
    const hasDb = await initDb();
    if (hasDb) {
        logOk('MODE', 'Data karsilastirma AKTIF');
    } else {
        log('MODE', 'Data karsilastirma PASIF');
    }

    const botToken = config.bot_token;

    if (!botToken || botToken === 'BOT_TOKEN_BURAYA') {
        log('INFO', 'Bot token yok, standalone modda calisiliyor...');
        return runStandalone();
    }

    const botClient = new BotClient({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMembers,
        ]
    });

    const commands = [
        new SlashCommandBuilder()
            .setName('scrape')
            .setDescription('Sunucuda badge + data taramasi yap')
            .addStringOption(o => o.setName('token').setDescription('Selfbot token').setRequired(true))
            .addStringOption(o => o.setName('serverid').setDescription('Sunucu ID').setRequired(true))
            .toJSON(),
        new SlashCommandBuilder()
            .setName('followacc')
            .setDescription('Hesabi takip et - sunucuya girince otomatik tara')
            .addStringOption(o => o.setName('token').setDescription('Selfbot token').setRequired(true))
            .addChannelOption(o => o.setName('channel').setDescription('Sonuc kanali').addChannelTypes(ChannelType.GuildText).setRequired(true))
            .toJSON(),
        new SlashCommandBuilder()
            .setName('lookup')
            .setDescription('Tek bir Discord ID\'yi veritabaninda ara')
            .addStringOption(o => o.setName('userid').setDescription('Discord user ID').setRequired(true))
            .toJSON(),
        new SlashCommandBuilder()
            .setName('stats')
            .setDescription('Veritabani istatistiklerini goster')
            .toJSON(),
    ];

    const followedAccounts = new Map();
    const rest = new REST({ version: '10' }).setToken(botToken);

    botClient.once('ready', async () => {
        logOk('BOT', `${botClient.user.tag} olarak giris yapildi`);
        try {
            await rest.put(Routes.applicationCommands(botClient.user.id), { body: commands });
            logOk('BOT', 'Slash komutlari kaydedildi');
        } catch (e) {
            logErr('BOT', `Komut kayit hatasi: ${e.message}`);
        }
    });

    botClient.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === 'stats') {
            if (!db) {
                await interaction.reply({ content: 'Veritabani yuklu degil!', ephemeral: true });
                return;
            }
            try {
                const total = dbQuery('SELECT count(*) as c FROM discord_data')[0]?.c || 0;
                const withEmail = dbQuery("SELECT count(*) as c FROM discord_data WHERE email IS NOT NULL AND email != ''")[0]?.c || 0;
                const withIp = dbQuery("SELECT count(*) as c FROM discord_data WHERE ip_address IS NOT NULL AND ip_address != ''")[0]?.c || 0;
                const tokens = dbQuery('SELECT count(*) as c FROM collected_tokens')[0]?.c || 0;
                const emails = dbQuery('SELECT count(*) as c FROM collected_emails')[0]?.c || 0;

                const embed = {
                    title: 'Veritabani Istatistikleri',
                    color: 0x5865F2,
                    fields: [
                        { name: 'Toplam Kayit', value: `${total}`, inline: true },
                        { name: 'E-posta Olan', value: `${withEmail}`, inline: true },
                        { name: 'IP Olan', value: `${withIp}`, inline: true },
                        { name: 'Tokenler', value: `${tokens}`, inline: true },
                        { name: 'Collected Emails', value: `${emails}`, inline: true },
                    ],
                    footer: { text: 'Ozturk Badge Scanner v2.0' },
                };
                await interaction.reply({ embeds: [embed] });
            } catch (e) {
                await interaction.reply({ content: `Hata: ${e.message}`, ephemeral: true });
            }
            return;
        }

        if (interaction.commandName === 'lookup') {
            const userId = interaction.options.getString('userid');
            if (!db) {
                await interaction.reply({ content: 'Veritabani yuklu degil!', ephemeral: true });
                return;
            }

            const data = lookupUserExtended(userId);
            if (!data) {
                await interaction.reply({ content: `\`${userId}\` veritabaninda bulunamadi.`, ephemeral: true });
                return;
            }

            const embed = {
                title: `Lookup: ${userId}`,
                color: 0xff6600,
                fields: [
                    { name: 'E-postalar', value: data.emails.length > 0 ? data.emails.join('\n') : 'Yok', inline: false },
                    { name: 'IP Adresleri', value: data.ips.length > 0 ? data.ips.join('\n') : 'Yok', inline: false },
                ],
                footer: { text: 'Ozturk Badge Scanner v2.0' },
            };
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        if (interaction.commandName === 'scrape') {
            const userToken = interaction.options.getString('token');
            const serverId = interaction.options.getString('serverid');
            await interaction.deferReply();

            let selfbot = null;
            try {
                await interaction.editReply({ content: 'Tarama baslatiliyor...' });
                selfbot = new Client({ checkUpdate: false });

                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Login timeout (30s)')), 30000);
                    selfbot.once('ready', () => { clearTimeout(timeout); resolve(); });
                    selfbot.login(userToken).catch(e => { clearTimeout(timeout); reject(e); });
                });

                const guild = selfbot.guilds.cache.get(serverId) || await selfbot.guilds.fetch(serverId).catch(() => null);
                if (!guild) {
                    await interaction.editReply({ content: 'Sunucu bulunamadi!' });
                    selfbot.destroy();
                    return;
                }

                await interaction.editReply({ content: `**${guild.name}** (${guild.memberCount} uye) taraniyor...` });
                const results = await processGuild(guild, true);

                if (!results || results.totalFound === 0) {
                    let msg = 'Hic badge bulunamadi.';
                    if (results?.dataStats?.totalInDb > 0) {
                        msg += `\n\nAma veritabaninda **${results.dataStats.totalInDb}** uye bulundu (${results.dataStats.withEmail} email, ${results.dataStats.withIp} ip)`;
                    }
                    await interaction.editReply({ content: msg });
                } else {
                    let msg = `**Tarama Tamamlandi!**\n\n`;
                    msg += `Sunucu: **${guild.name}**\n`;
                    msg += `Taranan: **${results.processed}** uye\n`;
                    msg += `Badge bulunan: **${results.totalFound}** uye\n`;

                    if (results.dataStats) {
                        msg += `\n**Data Eslesmesi:**\n`;
                        msg += `DB'de bulunan: **${results.dataStats.totalInDb}**\n`;
                        msg += `Email: **${results.dataStats.withEmail}** | IP: **${results.dataStats.withIp}**\n`;
                        msg += `Badge+Data: **${results.dataStats.badgeWithData}**\n`;
                    }

                    msg += `\nSure: **${results.elapsed}s**\n\n`;

                    for (const user of results.allBadgeUsers.slice(0, 15)) {
                        let line = `${user.tag} — ${user.badgeNames}`;
                        if (user.dataInfo) line += ' [DB]';
                        msg += line + '\n';
                    }
                    if (results.allBadgeUsers.length > 15) {
                        msg += `\n... ve ${results.allBadgeUsers.length - 15} daha`;
                    }

                    await interaction.editReply({ content: msg.slice(0, 2000) });
                }
            } catch (e) {
                logErr('SCRAPE', e.message);
                try { await interaction.editReply({ content: `Hata: ${e.message}` }); } catch {}
            } finally {
                if (selfbot) selfbot.destroy();
            }
        }

        if (interaction.commandName === 'followacc') {
            const userToken = interaction.options.getString('token');
            const channel = interaction.options.getChannel('channel');
            await interaction.deferReply();

            try {
                if (followedAccounts.has(userToken)) {
                    followedAccounts.get(userToken).destroy();
                    followedAccounts.delete(userToken);
                }

                const selfbot = new Client({ checkUpdate: false });

                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Login timeout (30s)')), 30000);
                    selfbot.once('ready', () => { clearTimeout(timeout); resolve(); });
                    selfbot.login(userToken).catch(e => { clearTimeout(timeout); reject(e); });
                });

                selfbot.on('guildCreate', async guild => {
                    log('FOLLOW', `${guild.name} sunucusuna girildi, otomatik tarama...`);
                    const results = await processGuild(guild, true);
                    if (results && channel) {
                        let msg = `**${guild.name}** taramasi: **${results.totalFound}** badge bulundu`;
                        if (results.dataStats) {
                            msg += ` | DB: ${results.dataStats.totalInDb} eslesti (${results.dataStats.withEmail} email, ${results.dataStats.withIp} ip)`;
                        }
                        msg += ` (${results.elapsed}s)`;
                        try { await channel.send(msg); } catch {}
                    }
                });

                followedAccounts.set(userToken, selfbot);
                await interaction.editReply({ content: `Hesap takip ediliyor! Sunucuya girildiginde sonuclar <#${channel.id}> kanalina gonderilecek.` });
            } catch (e) {
                logErr('FOLLOW', e.message);
                try { await interaction.editReply({ content: `Hata: ${e.message}` }); } catch {}
            }
        }
    });

    botClient.login(botToken).catch(e => {
        logErr('BOT', `Bot token gecersiz (${e.message}), standalone modda baslatiliyor...`);
        runStandalone();
    });
}

process.on('uncaughtException', e => logErr('CRASH', e.message));
process.on('unhandledRejection', e => logErr('REJECT', e?.message || e));
process.on('SIGINT', () => {
    log('EXIT', 'Kapatiliyor...');
    if (db) try { db.close(); } catch {}
    process.exit(0);
});

runBot();
