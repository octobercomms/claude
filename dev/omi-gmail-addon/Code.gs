/**
 * OMI for Gmail — contextual sidebar add-on.
 *
 * Opening a message shows the sender's journalist profile + recent coverage
 * from October Marketing Intelligence (via its PR add-on API), with one-tap
 * actions to log the thread to a client's editorial log or capture an unknown sender as a
 * press or industry contact.
 *
 * Config (Script Properties): OMI_BASE = https://platform.octobercomms.com/api/pr-addon
 *                             OMI_KEY  = the PR add-on key from Settings → PR · Gmail add-on.
 */

var PROPS = PropertiesService.getScriptProperties();

function getConfig() {
  return { base: PROPS.getProperty('OMI_BASE') || '', key: PROPS.getProperty('OMI_KEY') || '' };
}

// ── API helpers ───────────────────────────────────────────────────────────

function apiRequest(path, method, payload) {
  var cfg = getConfig();
  if (!cfg.base || !cfg.key) return null;
  var opts = {
    method: method || 'get',
    muteHttpExceptions: true,
    headers: { 'X-OMI-Key': cfg.key }
  };
  if (payload) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  try {
    var res = UrlFetchApp.fetch(cfg.base.replace(/\/$/, '') + path, opts);
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) return { _error: 'HTTP ' + code };
    return JSON.parse(res.getContentText() || '{}');
  } catch (err) {
    return { _error: String(err) };
  }
}

function extractEmail(from) {
  var m = /<([^>]+)>/.exec(from || '');
  return (m ? m[1] : (from || '')).trim().toLowerCase();
}
function extractName(from) {
  var n = (from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim();
  return n || '';
}

// ── Triggers ────────────────────────────────────────────────────────────────

function onHomepage() {
  var cfg = getConfig();
  if (!cfg.base || !cfg.key) return configCard().build();
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('OMI for Gmail'))
    .addSection(CardService.newCardSection().addWidget(
      CardService.newTextParagraph().setText('Open an email to see the sender’s coverage profile, log the thread, or add them to your database.')
    ))
    .build();
}

function onGmailMessageOpen(e) {
  var cfg = getConfig();
  if (!cfg.base || !cfg.key) return configCard().build();

  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  var msg = GmailApp.getMessageById(e.gmail.messageId);
  var thread = msg.getThread();
  var from = msg.getFrom();
  var email = extractEmail(from);
  var name = extractName(from);
  var subject = thread.getFirstMessageSubject();
  var threadId = thread.getId();

  var data = apiRequest('/lookup?email=' + encodeURIComponent(email), 'get');
  if (data && data._error) return errorCard(data._error).build();
  var clients = (data && data.clients) || [];
  if (data && data.matched) {
    return profileCard(data, name, email, subject, threadId, clients).build();
  }
  return addContactCard(name, email, subject, threadId, clients).build();
}

// ── Cards ─────────────────────────────────────────────────────────────────

function configCard() {
  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText('Connect this add-on to your October Marketing Intelligence platform.'))
    .addWidget(CardService.newTextInput().setFieldName('base').setTitle('API base URL')
      .setHint('e.g. https://platform.octobercomms.com/api/pr-addon'))
    .addWidget(CardService.newTextInput().setFieldName('key').setTitle('API key')
      .setHint('From Settings → PR · Gmail add-on'))
    .addWidget(CardService.newTextButton().setText('Save')
      .setOnClickAction(CardService.newAction().setFunctionName('saveConfig')));
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Connect OMI'))
    .addSection(section);
}

function errorCard(msg) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Couldn’t reach OMI'))
    .addSection(CardService.newCardSection()
      .addWidget(CardService.newTextParagraph().setText(msg + '. Check the base URL and key in the add-on settings.'))
      .addWidget(CardService.newTextButton().setText('Settings')
        .setOnClickAction(CardService.newAction().setFunctionName('onHomepage'))));
}

function saveConfig(e) {
  var base = formVal(e, 'base');
  var key = formVal(e, 'key');
  PROPS.setProperty('OMI_BASE', base);
  PROPS.setProperty('OMI_KEY', key);
  return notify('Connected.');
}

function profileCard(d, name, email, subject, threadId, clients) {
  var header = CardService.newCardHeader().setTitle(d.name || name).setSubtitle((d.outlet || '') + (d.segment === 'media' ? ' · journalist' : ''));
  if (d.photo_url) header.setImageUrl(d.photo_url).setImageStyle(CardService.ImageStyle.CIRCLE);

  var s = CardService.newCardSection();
  s.addWidget(CardService.newKeyValue().setTopLabel('Relationship').setContent((d.strength || 0) + '/100 · ' + (d.strength_label || '')));
  s.addWidget(CardService.newKeyValue().setTopLabel('Published coverage').setContent(String(d.published || 0)));
  if (d.last_featured) s.addWidget(CardService.newKeyValue().setTopLabel('Last featured').setContent(String(d.last_featured).slice(0, 10)));
  if (d.availability && d.availability !== 'active') s.addWidget(CardService.newKeyValue().setTopLabel('Availability').setContent(String(d.availability).replace(/_/g, ' ')));
  if (d.beats && d.beats.length) s.addWidget(CardService.newKeyValue().setTopLabel('Beats').setContent(d.beats.join(', ')));

  var rec = null;
  if (d.recent && d.recent.length) {
    rec = CardService.newCardSection().setHeader('Recent coverage');
    d.recent.forEach(function (r) {
      rec.addWidget(CardService.newKeyValue().setTopLabel((r.client || '') + ' · ' + (r.status || '')).setContent(r.title || ''));
    });
  }

  var card = CardService.newCardBuilder().setHeader(header).addSection(s);
  if (rec) card.addSection(rec);
  card.addSection(logThreadSection(email, name, subject, threadId, clients));
  return card;
}

function addContactCard(name, email, subject, threadId, clients) {
  var s = CardService.newCardSection().setHeader('Not in your database')
    .addWidget(CardService.newTextParagraph().setText('Add <b>' + (name || email) + '</b> to the contacts database.'))
    .addWidget(CardService.newTextInput().setFieldName('name').setTitle('Name').setValue(name || ''))
    .addWidget(CardService.newTextInput().setFieldName('publication').setTitle('Publication / company'))
    .addWidget(CardService.newTextInput().setFieldName('tags').setTitle('Tags / relevance').setHint('e.g. property developer, architecture'))
    .addWidget(CardService.newButtonSet()
      .addButton(CardService.newTextButton().setText('Add as press')
        .setOnClickAction(action('addContact', { email: email, segment: 'media' })))
      .addButton(CardService.newTextButton().setText('Add as industry')
        .setOnClickAction(action('addContact', { email: email, segment: 'commercial' }))));
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle(name || email))
    .addSection(s)
    .addSection(logThreadSection(email, name, subject, threadId, clients));
}

function logThreadSection(email, name, subject, threadId, clients) {
  var section = CardService.newCardSection().setHeader('Log this thread');
  if (clients && clients.length) {
    var clientPicker = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('client_id').setTitle('Client');
    clients.forEach(function (c, i) { clientPicker.addItem(c.name, String(c.id), i === 0); });
    section.addWidget(clientPicker);
  } else {
    section.addWidget(CardService.newTextParagraph().setText('No active clients found.'));
  }
  var status = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName('status').setTitle('Status')
    .addItem('Pitched', 'pitched', true)
    .addItem('Confirmed', 'confirmed', false)
    .addItem('Published', 'published', false)
    .addItem('Declined', 'declined', false);
  section.addWidget(status);
  section.addWidget(CardService.newTextButton().setText('Add to editorial log')
    .setOnClickAction(action('logThread', { email: email, name: name, subject: subject, threadId: threadId })));
  return section;
}

// ── Actions ─────────────────────────────────────────────────────────────────

function action(fn, params) {
  var a = CardService.newAction().setFunctionName(fn);
  if (params) a.setParameters(params);
  return a;
}

function formVal(e, key) {
  var f = (e.commonEventObject && e.commonEventObject.formInputs) || {};
  if (!f[key]) return '';
  if (f[key].stringInputs) return f[key].stringInputs.value[0] || '';
  return '';
}

function addContact(e) {
  var p = e.parameters || {};
  var res = apiRequest('/contacts', 'post', {
    name: formVal(e, 'name'),
    email: p.email,
    segment: p.segment,
    publication: formVal(e, 'publication'),
    tags: formVal(e, 'tags')
  });
  if (!res || res._error) return notify('Could not add contact.');
  return notify(p.segment === 'media' ? 'Added to media database.' : 'Added as industry contact.');
}

function logThread(e) {
  var p = e.parameters || {};
  var clientId = formVal(e, 'client_id');
  if (!clientId) return notify('Pick a client first.');
  var res = apiRequest('/editorial-log', 'post', {
    client_id: clientId,
    story_title: p.subject,
    press_contact: p.name,
    email: p.email,
    status: formVal(e, 'status') || 'pitched',
    notes_outcome: 'Logged from Gmail'
  });
  if (!res || res._error) return notify('Could not log thread.');
  return notify('Thread logged to the editorial log.');
}

function notify(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}
