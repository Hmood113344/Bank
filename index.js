// index.js
const { Client, GatewayIntentBits, Partials, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const config = require('./config.json');
const Sequelize = require('sequelize');
const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

// DB
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './bank.sqlite',
  logging: false
});

const User = sequelize.define('User', {
  discordId: { type: Sequelize.STRING, unique: true, allowNull: false },
  bankBalance: { type: Sequelize.INTEGER, defaultValue: 0 }, // بالهللات
  cashBalance: { type: Sequelize.INTEGER, defaultValue: 0 }
});

const Transaction = sequelize.define('Transaction', {
  userId: { type: Sequelize.STRING, allowNull: false },
  type: { type: Sequelize.STRING },
  amount: { type: Sequelize.INTEGER },
  note: { type: Sequelize.STRING }
});

const Application = sequelize.define('Application', {
  discordId: { type: Sequelize.STRING, allowNull: false },
  nameEnglish: { type: Sequelize.STRING },
  fromWhere: { type: Sequelize.STRING },
  job: { type: Sequelize.STRING },
  salary: { type: Sequelize.INTEGER }, // هللات
  status: { type: Sequelize.STRING, defaultValue: 'pending' },
  appImagePath: { type: Sequelize.STRING }
});

// helpers
const feeSar = Number(config.transferFeeSar || 0.25);
const feeHalalas = Math.round(feeSar * 100);

function toHalalas(s) {
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error('invalid');
  return Math.round(n * 100);
}
function fmt(halalas) {
  return (halalas/100).toFixed(2) + ' SAR';
}

async function ensureUser(id) {
  let u = await User.findOne({ where: { discordId: id } });
  if (!u) u = await User.create({ discordId: id, bankBalance: 0, cashBalance: 0 });
  return u;
}

function randDigits(len = 11) {
  let s = '';
  for (let i=0;i<len;i++) s += Math.floor(Math.random()*10);
  return s;
}

// canvas functions: generate application card (small) and final bank card
async function generateApplicationImage(data) {
  const w = 800, h = 400;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // background
  ctx.fillStyle = '#0B5A81';
  ctx.fillRect(0,0,w,h);

  // header
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px Sans';
  ctx.fillText(config.bankName || 'بنك الرياض', 20, 40);

  // card box
  ctx.fillStyle = '#fff';
  ctx.fillRect(20, 70, w-40, h-140);
  ctx.fillStyle = '#000';
  ctx.font = '20px Sans';
  ctx.fillText(`Name: ${data.nameEnglish}`, 40, 110);
  ctx.fillText(`From: ${data.fromWhere}`, 40, 150);
  ctx.fillText(`Job: ${data.job}`, 40, 190);
  ctx.fillText(`Salary: ${ (data.salary/100).toFixed(2) } SAR`, 40, 230);
  ctx.fillStyle = '#666';
  ctx.font = '16px Sans';
  ctx.fillText(`Applicant ID: ${data.discordId}`, 40, 270);

  return canvas.toBuffer();
}

async function generateFinalCardImage(data) {
  const w = 1000, h = 600;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // background gradient
  const grad = ctx.createLinearGradient(0,0,w,0);
  grad.addColorStop(0,'#1a73e8');
  grad.addColorStop(1,'#0b5a81');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,w,h);

  // card rectangle
  ctx.fillStyle = '#fff';
  ctx.fillRect(50, 50, w-100, h-100);

  // name (left top)
  ctx.fillStyle = '#000';
  ctx.font = 'bold 36px Sans';
  ctx.fillText(data.nameEnglish, 90, 120);

  // card number (middle left)
  ctx.font = 'bold 40px Sans';
  ctx.fillText(data.cardNumber, 90, 220);

  // expiry (under number)
  ctx.font = '24px Sans';
  ctx.fillText('EXP: ' + data.expiry, 90, 270);

  // middle right: مدى
  ctx.font = 'bold 48px Sans';
  ctx.fillText('مدى', w - 300, 200);

  // bottom right: VISA (styled)
  ctx.font = 'italic 40px Sans';
  ctx.fillText('VISA', w - 220, h - 120);

  return canvas.toBuffer();
}

// temp store for multi-step reg flows
const regTemp = new Map(); // key: userId -> { step, data }

client.once(Events.ClientReady, async () => {
  await sequelize.sync();
  console.log(`${config.bankName || 'Bank'} bot ready as ${client.user.tag}`);
});

// handle slash commands to post embeds (only allowed to those with ManageGuild)
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;
    const member = interaction.member;

    // require manage guild permission for posting these control messages
    if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: 'عشان تستخدم هالأمر لازم يكون عندك صلاحية Manage Server.', ephemeral: true });
    }

    if (cmd === 'send_registration_embed') {
      const embed = new EmbedBuilder()
        .setTitle(`${config.bankName} - تسجيل حساب`)
        .setDescription('اضغط **تسجيل حساب في البنك** وبعدين راح يجيك خواص البوت عشان تسجل بياناتك.')
        .setColor('#0B5A81');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_registration').setLabel('تسجيل حساب في البنك').setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({ embeds: [embed], components: [row] });
    }

    if (cmd === 'send_bank_panel') {
      const embed = new EmbedBuilder()
        .setTitle(`${config.bankName}`)
        .setDescription('أهلاً بك في بنك الرياض — استخدم الأزرار للاطلاع على بياناتك وإجراء عمليات مالية.')
        .setColor('#0B5A81');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_mydata').setLabel('بياناتي').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_withdraw').setLabel('سحب رصيد').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('btn_deposit').setLabel('ايداع').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('btn_transfer').setLabel('تحويل').setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({ embeds: [embed], components: [row] });
    }

    if (cmd === 'send_admin_panel') {
      const embed = new EmbedBuilder()
        .setTitle(`${config.bankName} - لوحة المسؤولين`)
        .setDescription('الزرّات التالية مخصصة لمسؤولي البنك.')
        .setColor('#b31515');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_add').setLabel('اضافة رصيد لشخص').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('admin_remove').setLabel('حذف مبلغ من شخص').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('admin_statement').setLabel('كشف حساب').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ embeds: [embed], components: [row] });
    }

  } catch (err) {
    console.error(err);
  }
});

// Button interactions & modals
client.on(Events.InteractionCreate, async interaction => {
  try {
    // Button clicks
    if (interaction.isButton()) {
      const id = interaction.customId;

      // -------------------------
      // 1) Registration button
      // -------------------------
      if (id === 'open_registration') {
        // reply ephemerally and start DM modal chain
        await interaction.reply({ content: 'توجه خاص — راح أرسل لك رسالة خاصة عشان تكمل تسجيل البيانات ✅', ephemeral: true });

        // start by showing a modal (works in guild interaction)
        const modal = new ModalBuilder().setCustomId('reg_name_modal').setTitle('تسجيل في بنك الرياض (1/4)');
        const input = new TextInputBuilder().setCustomId('nameEnglish').setLabel('اسمك (انقليزي)').setStyle(TextInputStyle.Short).setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);
        await interaction.showModal(modal);
        return;
      }

      // -------------------------
      // 2) Public bank panel buttons
      // -------------------------
      if (id === 'btn_mydata' || id === 'btn_withdraw' || id === 'btn_deposit' || id === 'btn_transfer') {
        // open DM with user (we reply ephemeral then show modal if needed)
        if (id === 'btn_mydata') {
          await interaction.reply({ content: 'تم إرسال بياناتك في الخاص 👌', ephemeral: true });
          // DM
          const u = await ensureUser(interaction.user.id);
          const embed = new EmbedBuilder()
            .setTitle(`${config.bankName} — بياناتك`)
            .setDescription(`أهلاً في بنك الرياض\n\nرصيد البنك: **${fmt(u.bankBalance)}**\nرصيد الكاش: **${fmt(u.cashBalance)}**`)
            .setColor('#0B5A81');
          await interaction.user.send({ embeds: [embed] }).catch(()=>{ interaction.followUp({ content:'ما قدر ارسل خاص، افتح الخاص وخليك متاح.', ephemeral:true }) });
          return;
        }

        if (id === 'btn_withdraw') {
          // show modal for amount
          const modal = new ModalBuilder().setCustomId('modal_withdraw').setTitle('سحب رصيد');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('amount').setLabel('المبلغ بالريال (مثال: 50.25)').setStyle(TextInputStyle.Short).setRequired(true)
          ));
          await interaction.showModal(modal);
          return;
        }

        if (id === 'btn_deposit') {
          const modal = new ModalBuilder().setCustomId('modal_deposit').setTitle('ايداع رصيد');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('amount').setLabel('المبلغ بالريال (مثال: 30)').setStyle(TextInputStyle.Short).setRequired(true)
          ));
          await interaction.showModal(modal);
          return;
        }

        if (id === 'btn_transfer') {
          const modal = new ModalBuilder().setCustomId('modal_transfer').setTitle('تحويل رصيد');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('targetId').setLabel('ايدي حساب ديسكورد المستلم').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('المبلغ بالريال').setStyle(TextInputStyle.Short).setRequired(true))
          );
          await interaction.showModal(modal);
          return;
        }
      }

      // -------------------------
      // 3) Admin panel buttons (only role)
      // -------------------------
      if (id === 'admin_add' || id === 'admin_remove' || id === 'admin_statement' || id === 'app_accept' || id === 'app_reject') {
        // check role
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(config.adminRoleId)) {
          return interaction.reply({ content: 'ما عندك صلاحية مسؤول البنك لهذا الزر.', ephemeral: true });
        }

        if (id === 'admin_add') {
          const modal = new ModalBuilder().setCustomId('admin_add_modal').setTitle('اضافة رصيد');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('targetId').setLabel('ايدي حساب ديسكورد').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('المبلغ بالريال').setStyle(TextInputStyle.Short).setRequired(true))
          );
          await interaction.showModal(modal);
          return;
        }
        if (id === 'admin_remove') {
          const modal = new ModalBuilder().setCustomId('admin_remove_modal').setTitle('حذف مبلغ من شخص');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('targetId').setLabel('ايدي حساب ديسكورد').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('المبلغ بالريال').setStyle(TextInputStyle.Short).setRequired(true))
          );
          await interaction.showModal(modal);
          return;
        }
        if (id === 'admin_statement') {
          const modal = new ModalBuilder().setCustomId('admin_statement_modal').setTitle('كشف حساب');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('targetId').setLabel('ايدي حساب ديسكورد').setStyle(TextInputStyle.Short).setRequired(true)));
          await interaction.showModal(modal);
          return;
        }

        // app accept/reject handled below (customIds include app_ prefix)
      }

      // -------------------------
      // 4) Application accept/reject buttons (in applications channel)
      // -------------------------
      if (id.startsWith('app_accept:') || id.startsWith('app_reject:')) {
        // format app_accept:<appId>
        const [action, appId] = id.split(':');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(config.adminRoleId)) {
          return interaction.reply({ content: 'ما عندك صلاحية المسؤول.' , ephemeral: true });
        }

        const app = await Application.findOne({ where: { id: appId }});
        if (!app) return interaction.reply({ content: 'الطلب غير موجود', ephemeral: true });

        if (action === 'app_reject') {
          app.status = 'rejected';
          await app.save();
          await interaction.reply({ content: `تم رفض الطلب ${app.id}`, ephemeral: true });
          // notify applicant
          await client.users.fetch(app.discordId).then(u => u.send({ content: `طلبك في ${config.bankName} تم رفضه.` })).catch(()=>{});
          return;
        }

        if (action === 'app_accept') {
          // create final card and send DM
          const cardNumber = randDigits(11);
          const expiry = '12/2030'; // can randomize
          const finalImageBuffer = await generateFinalCardImage({
            nameEnglish: app.nameEnglish,
            cardNumber,
            expiry
          });

          const fileName = `final_card_${app.discordId}.png`;
          const attachment = new AttachmentBuilder(finalImageBuffer, { name: fileName });

          // set user account if not exists
          await ensureUser(app.discordId);

          app.status = 'accepted';
          await app.save();

          // reply in admin channel and DM applicant
          await interaction.reply({ content: `تم قبول الطلب وتم إرسال بطاقة للبريد الخاص للمتقدم (ID: ${app.discordId})`, ephemeral: true });

          // DM applicant
          await client.users.fetch(app.discordId).then(u => {
            u.send({ content: `تم قبول طلبك في ${config.bankName}. هذه بطاقتك:`, files: [attachment] }).catch(()=>{});
          }).catch(()=>{});

          return;
        }
      }

    } // end isButton()

    // Modal submissions
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      // Registration multi-step
      if (id === 'reg_name_modal') {
        const nameEnglish = interaction.fields.getTextInputValue('nameEnglish');
        // store
        regTemp.set(interaction.user.id, { step: 1, data: { nameEnglish } });
        // show next modal
        const modal = new ModalBuilder().setCustomId('reg_from_modal').setTitle('تسجيل في بنك الرياض (2/4)');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fromWhere').setLabel('من وين').setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.reply({ content: 'تم استلام الاسم — ارسل السؤال الثاني...', ephemeral: true });
        return interaction.showModal(modal);
      }

      if (id === 'reg_from_modal') {
        const fromWhere = interaction.fields.getTextInputValue('fromWhere');
        const prev = regTemp.get(interaction.user.id) || { data: {} };
        prev.step = 2; prev.data.fromWhere = fromWhere;
        regTemp.set(interaction.user.id, prev);

        const modal = new ModalBuilder().setCustomId('reg_job_modal').setTitle('تسجيل في بنك الرياض (3/4)');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('job').setLabel('الوظيفه').setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.reply({ content: 'تم استلام المكان — ارسل السؤال الثالث...', ephemeral: true });
        return interaction.showModal(modal);
      }

      if (id === 'reg_job_modal') {
        const job = interaction.fields.getTextInputValue('job');
        const prev = regTemp.get(interaction.user.id) || { data: {} };
        prev.step = 3; prev.data.job = job;
        regTemp.set(interaction.user.id, prev);

        const modal = new ModalBuilder().setCustomId('reg_salary_modal').setTitle('تسجيل في بنك الرياض (4/4)');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('salary').setLabel('راتبك بالريال (مثال: 3000)').setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.reply({ content: 'تم استلام الوظيفة — ارسل السؤال الرابع...', ephemeral: true });
        return interaction.showModal(modal);
      }

      if (id === 'reg_salary_modal') {
        const salaryStr = interaction.fields.getTextInputValue('salary');
        let salaryHalalas;
        try {
          salaryHalalas = toHalalas(salaryStr);
        } catch(e) {
          await interaction.reply({ content: 'المبلغ غير صالح.', ephemeral: true });
          regTemp.delete(interaction.user.id);
          return;
        }
        const prev = regTemp.get(interaction.user.id) || { data: {} };
        prev.step = 4; prev.data.salary = salaryHalalas;
        // save application in DB
        const app = await Application.create({
          discordId: interaction.user.id,
          nameEnglish: prev.data.nameEnglish,
          fromWhere: prev.data.fromWhere,
          job: prev.data.job,
          salary: prev.data.salary,
          status: 'pending'
        });

        // generate image
        const buf = await generateApplicationImage(prev.data);
        const fileName = `application_${interaction.user.id}_${app.id}.png`;
        const filePath = path.join(__dirname, fileName);
        fs.writeFileSync(filePath, buf);
        app.appImagePath = fileName;
        await app.save();

        // send to applications channel with buttons
        const appChannel = await client.channels.fetch(config.applicationsChannelId).catch(()=>null);
        if (appChannel) {
          const attachment = new AttachmentBuilder(buf, { name: fileName });
          const embed = new EmbedBuilder()
            .setTitle(`طلب انضمام جديد — ${config.bankName}`)
            .setDescription(`اسم: **${app.nameEnglish}**\nمن: **${app.fromWhere}**\nالوظيفة: **${app.job}**\nالراتب: **${(app.salary/100).toFixed(2)} SAR**`)
            .setImage(`attachment://${fileName}`)
            .setColor('#0B5A81');

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`app_accept:${app.id}`).setLabel('قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`app_reject:${app.id}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
          );

          await appChannel.send({ embeds: [embed], files: [attachment], components: [row] });
        }

        await interaction.reply({ content: 'تم إرسال بياناتك لإدارة البنك ✅', ephemeral: true });
        regTemp.delete(interaction.user.id);
        return;
      }

      // -------------------------
      // Public modals: withdraw/deposit/transfer
      // -------------------------
      if (id === 'modal_withdraw') {
        const amountStr = interaction.fields.getTextInputValue('amount');
        let amountHal;
        try { amountHal = toHalalas(amountStr); } catch { return interaction.reply({ content: 'المبلغ غير صالح', ephemeral: true }); }
        const u = await ensureUser(interaction.user.id);
        if (u.bankBalance < amountHal) {
          return interaction.reply({ content: 'مرفوضه — ليس لديك رصيد كافي في البنك.', ephemeral: true });
        }
        u.bankBalance -= amountHal;
        u.cashBalance += amountHal;
        await u.save();
        await Transaction.create({ userId: interaction.user.id, type: 'withdraw', amount: -amountHal, note: 'سحب' });
        return interaction.reply({ content: `تم سحب ${fmt(amountHal)} وتمت إضافتها للكاش.`, ephemeral: true });
      }

      if (id === 'modal_deposit') {
        const amountStr = interaction.fields.getTextInputValue('amount');
        let amountHal;
        try { amountHal = toHalalas(amountStr); } catch { return interaction.reply({ content: 'المبلغ غير صالح', ephemeral: true }); }
        const u = await ensureUser(interaction.user.id);
        if (u.cashBalance < amountHal) {
          return interaction.reply({ content: 'مرفوضه — ليس لديك مبلغ كاش كافي.', ephemeral: true });
        }
        u.cashBalance -= amountHal;
        u.bankBalance += amountHal;
        await u.save();
        await Transaction.create({ userId: interaction.user.id, type: 'deposit', amount: amountHal, note: 'ايداع' });
        return interaction.reply({ content: `تم إيداع ${fmt(amountHal)} الى البنك.`, ephemeral: true });
      }

      if (id === 'modal_transfer') {
        const targetId = interaction.fields.getTextInputValue('targetId').replace(/[<@!> ]/g,'');
        const amountStr = interaction.fields.getTextInputValue('amount');
        let amountHal;
        try { amountHal = toHalalas(amountStr); } catch { return interaction.reply({ content: 'المبلغ غير صالح', ephemeral: true }); }
        const u = await ensureUser(interaction.user.id);
        const totalDeduct = amountHal + feeHalalas;
        if (u.bankBalance < totalDeduct) {
          return interaction.reply({ content: 'مرفوضه — الرصيد غير كافي (شامل الرسوم).', ephemeral: true });
        }
        // target must exist or create
        const targetUser = await ensureUser(targetId);
        u.bankBalance -= totalDeduct;
        targetUser.bankBalance += amountHal;
        await u.save();
        await targetUser.save();
        await Transaction.create({ userId: interaction.user.id, type: 'transfer_out', amount: -amountHal, note: `تحويل إلى ${targetId}` });
        await Transaction.create({ userId: targetId, type: 'transfer_in', amount: amountHal, note: `استلام من ${interaction.user.id}` });

        // give fee to admins: simplest => add fee to first admin found (or to a special account)
        // We'll add fee to bot owner account if possible (client.application.owner not always available). Simpler: store fee nowhere OR add to a treasury user id 'BANK_TREASURY'
        const treasuryId = 'BANK_TREASURY';
        let treasury = await User.findOne({ where: { discordId: treasuryId } });
        if (!treasury) treasury = await User.create({ discordId: treasuryId, bankBalance: feeHalalas, cashBalance: 0 });
        else { treasury.bankBalance += feeHalalas; await treasury.save(); }
        await Transaction.create({ userId: treasuryId, type: 'fee', amount: feeHalalas, note: `رسوم تحويل من ${interaction.user.id}` });

        // notify sender and target
        await interaction.reply({ content: `تم تحويل ${fmt(amountHal)} إلى <@${targetId}> (خصم ${fmt(feeHalalas)} رسوم).`, ephemeral: true });
        // DM recipient
        await client.users.fetch(targetId).then(u2 => {
          u2.send({ content: `تحويل وارد من ${interaction.user.tag}\nالمبلغ: ${fmt(amountHal)}` }).catch(()=>{});
        }).catch(()=>{});
        return;
      }

      // -------------------------
      // Admin modals: add/remove/statement
      // -------------------------
      if (id === 'admin_add_modal') {
        const targetId = interaction.fields.getTextInputValue('targetId').replace(/[<@!> ]/g,'');
        const amountStr = interaction.fields.getTextInputValue('amount');
        let amt;
        try { amt = toHalalas(amountStr); } catch { return interaction.reply({ content: 'المبلغ غير صالح', ephemeral: true }); }
        const target = await ensureUser(targetId);
        target.bankBalance += amt;
        await target.save();
        await Transaction.create({ userId: targetId, type: 'admin_add', amount: amt, note: `اضافة بواسطة ${interaction.user.id}` });
        // notify
        await client.users.fetch(targetId).then(u => u.send({ content: `تم إضافة ${fmt(amt)} لحسابك من قبل مسؤولي ${config.bankName}` }).catch(()=>{})).catch(()=>{});
        return interaction.reply({ content: `تم إضافة ${fmt(amt)} الى ${targetId}`, ephemeral: true });
      }

      if (id === 'admin_remove_modal') {
        const targetId = interaction.fields.getTextInputValue('targetId').replace(/[<@!> ]/g,'');
        const amountStr = interaction.fields.getTextInputValue('amount');
        let amt;
        try { amt = toHalalas(amountStr); } catch { return interaction.reply({ content: 'المبلغ غير صالح', ephemeral: true }); }
        const target = await ensureUser(targetId);
        target.bankBalance -= amt;
        if (target.bankBalance < 0) target.bankBalance = 0;
        await target.save();
        await Transaction.create({ userId: targetId, type: 'admin_remove', amount: -amt, note: `حذف بواسطة ${interaction.user.id}` });
        await client.users.fetch(targetId).then(u => u.send({ content: `تم حذف ${fmt(amt)} من رصيدك من قبل مسؤولي ${config.bankName}` }).catch(()=>{})).catch(()=>{});
        return interaction.reply({ content: `تم حذف ${fmt(amt)} من ${targetId}`, ephemeral: true });
      }

      if (id === 'admin_statement_modal') {
        const targetId = interaction.fields.getTextInputValue('targetId').replace(/[<@!> ]/g,'');
        const target = await ensureUser(targetId);
        const embed = new EmbedBuilder()
          .setTitle(`كشف حساب - ${config.bankName}`)
          .setDescription(`كشف حساب ل <@${targetId}>`)
          .addFields(
            { name: 'رصيد البنك', value: fmt(target.bankBalance), inline: true },
            { name: 'رصيد الكاش', value: fmt(target.cashBalance), inline: true }
          ).setColor('#0B5A81');
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

    } // end modal submit

  } catch (err) {
    console.error('Interaction error', err);
    try { if (interaction.replied || interaction.deferred) interaction.followUp({ content: 'صار خطأ', ephemeral: true }); else interaction.reply({ content: 'صار خطأ', ephemeral: true }); } catch(e){}
  }
});

client.login(config.token);
