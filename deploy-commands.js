// deploy-commands.js
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');
const config = require('./config.json');

const commands = [
  { name: 'send_registration_embed', description: 'نشر رسالة تسجيل حساب (للمشرفين)'},
  { name: 'send_bank_panel', description: 'نشر لوحة البنك العامة (للمشرفين)'},
  { name: 'send_admin_panel', description: 'نشر لوحة مسؤولين البنك (للمشرفين)'}
];

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (config.guildId && config.guildId.length) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
      console.log('Commands registered for guild', config.guildId);
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
      console.log('Global commands registered (may take up to 1 hour).');
    }
  } catch (err) {
    console.error(err);
  }
})();
