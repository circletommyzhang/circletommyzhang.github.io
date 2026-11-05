(function () {
  'use strict';
  const root = document.querySelector('[data-hrqa]');
  if (!root) return;
  const mode = root.dataset.hrqa;
  const cfg = window.HRQA_CONFIG;
  const client = cfg && window.supabase ? window.supabase.createClient(cfg.url, cfg.key, {
    auth: { storageKey: mode === 'admin' ? 'hrqa-admin-session' : 'hrqa-visitor-session', detectSessionInUrl: false }
  }) : null;
  const $ = (selector, within = root) => within.querySelector(selector);
  function node(tag, cls, value) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (value !== undefined && value !== null) n.textContent = String(value);
    return n;
  }
  function date(value) {
    return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function message(target, text, error = false) {
    target.replaceChildren(node('p', 'qa-feedback', text));
    target.firstChild.dataset.error = String(error);
  }
  function errorText(error) {
    const text = error && error.message || '';
    if (/anonymous.*disabled/i.test(text)) return '匿名提交尚未开启，请稍后再试。';
    if (/Failed to fetch|fetch failed|NetworkError|Load failed/i.test(text)) return '暂时连接不上，请稍后重试。';
    if (/PGRST202|schema cache|Could not find the function/i.test(text)) return '问答功能正在配置，请稍后再来。';
    if (/Invalid login credentials/i.test(text)) return '邮箱或密码不正确。';
    if (/rate.limit|too many/i.test(text)) return '提交较频繁，请稍后再试。';
    return /[\u4e00-\u9fff]/.test(text) ? text : '操作未完成，请稍后重试。';
  }
  async function rpc(name, args) {
    if (!client) throw new Error('问答功能正在加载，请刷新页面。');
    const { data, error } = await client.rpc('hrqa_' + name, args || {});
    if (error) throw error;
    return data;
  }
  let visitorPromise = null;
  async function visitor() {
    if (visitorPromise) return visitorPromise;
    visitorPromise = establishVisitor();
    try { return await visitorPromise; } finally { visitorPromise = null; }
  }
  async function establishVisitor() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      const result = await client.auth.signInAnonymously();
      if (result.error) throw result.error;
    }
    return await rpc('visitor_name');
  }
  function meta(nicknameValue, created, owner) {
    const m = node('div', 'qa-meta');
    m.append(node('span', 'qa-name', nicknameValue), node('span', '', date(created)));
    if (owner) m.append(node('span', 'qa-badge', '站长'));
    return m;
  }
  function button(text, handler, cls) {
    const b = node('button', cls || '', text); b.type = 'button';
    b.addEventListener('click', handler); return b;
  }
  async function busy(form, action) {
    const controls = Array.from(form.querySelectorAll('button,input,textarea,select'));
    controls.forEach(c => { c.disabled = true; });
    try { return await action(); } finally { controls.forEach(c => { c.disabled = false; }); }
  }
  function commentForm(container, context, list, reload) {
    const section = node('section', 'qa-section');
    const isAnswer = !!context.id && !context.path;
    section.append(node('h2', '', isAnswer ? '参与回答' : '留下评论'));
    const form = node('form', 'qa-form'); form.method = 'post';
    const bodyWrap = node('div');
    const bodyLabel = node('label', '', isAnswer ? '你的回答' : '评论内容'); bodyLabel.htmlFor = 'qa-comment-body';
    const body = node('textarea'); body.id = 'qa-comment-body'; body.required = true; body.maxLength = 6000; body.rows = 5;
    bodyWrap.append(bodyLabel, body);
    const replyContext = node('div', 'qa-reply-context'); replyContext.hidden = true;
    let parent = null;
    const feedback = node('div'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    const actions = node('div', 'qa-actions');
    const submit = node('button', 'qa-primary', isAnswer ? '提交回答' : '提交评论'); submit.type = 'submit';
    actions.append(submit, node('span', 'qa-note', isAnswer ? '回答审核后显示。' : '评论审核后显示。'));
    form.append(replyContext, bodyWrap, actions, feedback); section.append(form); container.append(section);
    function setReply(item) {
      parent = item.id; replyContext.replaceChildren(node('span', '', '回复 ' + item.nickname + ' '));
      replyContext.append(button('取消回复', () => { parent = null; replyContext.hidden = true; }, 'qa-reply'));
      replyContext.hidden = false; body.focus();
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    list.setReply = setReply;
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      busy(form, async () => {
        feedback.replaceChildren();
        try {
          const name = await visitor();
          await rpc('submit_comment', { p_body: body.value.trim(), p_nickname: name,
            p_thread_id: context.id || null, p_article_path: context.path || null,
            p_article_title: context.title || null, p_parent_id: parent });
          body.value = ''; parent = null; replyContext.hidden = true;
          message(feedback, '已提交，审核通过后就会显示。');
          if (reload) await reload();
        } catch (error) { message(feedback, errorText(error), true); }
      });
    });
  }
  function comments(list, items) {
    list.replaceChildren();
    if (!items.length) { list.append(node('p', 'qa-empty', '还没有公开评论，欢迎交流。')); return; }
    const byId = new Map(items.map(i => [i.id, i]));
    items.forEach(item => {
      const box = node('article', 'qa-comment'); box.id = 'comment-' + item.id;
      box.append(meta(item.nickname, item.created_at, item.is_owner));
      if (item.parent_id && byId.has(item.parent_id)) {
        const p = byId.get(item.parent_id); box.append(node('div', 'qa-quote', '回复 ' + p.nickname + '：' + p.body.slice(0, 160)));
      }
      box.append(node('div', 'qa-message', item.body), button('回复', () => list.setReply && list.setReply(item), 'qa-reply'));
      list.append(box);
    });
  }
  function discussionPager(container, list, context, initial) {
    let items = initial ? initial.messages : [];
    let total = initial ? initial.message_count : 0;
    const more = button('加载更多讨论', async () => {
      more.disabled = true;
      try {
        const data = await rpc('get_thread', { p_id: context.id || null, p_path: context.path || null, p_offset: items.length });
        if (data) {
          const unique = new Map(items.concat(data.messages).map(item => [item.id, item]));
          items = Array.from(unique.values()); total = data.message_count;
        } else total = items.length;
        comments(list, items); more.hidden = items.length >= total; feedback.replaceChildren();
      } catch (error) { message(feedback, errorText(error), true); }
      finally { more.disabled = false; }
    });
    const feedback = node('div'); feedback.setAttribute('role', 'status');
    more.hidden = items.length >= total; container.append(more, feedback); comments(list, items);
  }
  async function questionList() {
    const list = $('#qa-list'), feedback = $('#qa-list-feedback'), more = $('#qa-more');
    let offset = 0;
    async function load() {
      more.disabled = true;
      try {
        const data = await rpc('list_questions', { p_offset: offset });
        if (!offset) list.replaceChildren();
        data.forEach(item => {
          const box = node('article', 'qa-card');
          const title = node('h2'), link = node('a', '', item.title); link.href = '/qa/?id=' + encodeURIComponent(item.id); title.append(link);
          box.append(title, meta(item.nickname, item.created_at, false), node('div', 'qa-message qa-excerpt', item.body));
          const status = node('div', 'qa-meta');
          status.append(node('span', item.comment_count > 0 ? 'qa-badge' : '', item.comment_count > 0 ? '已有回答' : '等待回答'), node('span', '', item.comment_count + ' 条讨论'));
          box.append(status); list.append(box);
        });
        offset += data.length; more.hidden = data.length < 20; feedback.replaceChildren();
        if (!offset) list.append(node('p', 'qa-empty', '暂时还没有公开问题，欢迎留下你的问题。'));
      } catch (error) { message(feedback, errorText(error), true); more.hidden = false; more.textContent = '重新加载'; }
      finally { more.disabled = false; }
    }
    more.addEventListener('click', load);
    const form = $('#qa-question-form'), feedbackForm = $('#qa-question-feedback');
    const questionBody = $('[name=body]', form), questionButton = $('[type=submit]', form);
    function syncQuestionButton() { questionButton.disabled = !questionBody.value.trim(); }
    questionBody.addEventListener('input', syncQuestionButton);
    syncQuestionButton();
    form.addEventListener('submit', event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const body = $('[name=body]', form).value.trim();
      if (!body) { message(feedbackForm, '请填写你的问题。', true); return; }
      const compact = body.replace(/\s+/g, ' ');
      const beginning = compact.split(/[。？！?!]/)[0] || compact;
      const chars = Array.from(beginning);
      const title = chars.slice(0, 60).join('') + (chars.length > 60 ? '…' : '');
      questionButton.textContent = '提交中…'; form.setAttribute('aria-busy', 'true');
      busy(form, async () => {
        feedbackForm.replaceChildren();
        try {
          const name = await visitor();
          await rpc('submit_question', { p_title: title, p_body: body, p_nickname: name });
          $('[name=body]', form).value = '';
          message(feedbackForm, '问题已提交，回答后会显示在下方。');
        } catch (error) { message(feedbackForm, errorText(error), true); }
      }).finally(() => {
        questionButton.textContent = '提交问题'; form.setAttribute('aria-busy', 'false'); syncQuestionButton();
      });
    });
    await load();
  }
  async function thread(id) {
    const content = $('#qa-thread-content'), feedback = $('#qa-thread-feedback');
    try {
      const data = await rpc('get_thread', { p_id: id });
      if (!data) { message(feedback, '该问题尚未公开或不存在。'); return; }
      document.title = data.title + ' | 猎头张振';
      const list = node('div');
      content.append(node('h1', 'qa-thread-title', data.title), meta(data.nickname, data.created_at), node('div', 'qa-message', data.body));
      const section = node('section', 'qa-section'); section.append(node('h2', '', '回答与讨论'), list); content.append(section);
      discussionPager(section, list, { id: data.id }, data);
      commentForm(content, { id: data.id }, list, null);
      feedback.replaceChildren();
    } catch (error) { message(feedback, errorText(error), true); }
  }
  async function article() {
    let path; try { path = decodeURI(location.pathname); } catch (_) { path = location.pathname; }
    path = path.replace(/index\.html$/, '').replace(/\/?$/, '/');
    const title = document.querySelector('.article-title')?.textContent.trim() || document.title.split('|')[0].trim();
    root.append(node('h2', '', '评论'), node('p', 'qa-muted', '欢迎交流。评论审核后公开，张振可以在这里回复你。'));
    const discussion = node('div'), list = node('div'), feedback = node('div'); feedback.setAttribute('role', 'status');
    discussion.append(feedback, list); root.append(discussion);
    async function load() {
      try { const data = await rpc('get_thread', { p_path: path }); discussionPager(list.parentNode, list, { path }, data); feedback.replaceChildren(); }
      catch (error) { message(feedback, errorText(error), true); }
    }
    commentForm(root, { path, title }, list, null); await load();
  }
  async function admin() {
    const login = $('#qa-login'), board = $('#qa-admin-board'), loginFeedback = $('#qa-login-feedback');
    const list = $('#qa-admin-list'), feedback = $('#qa-admin-feedback'), status = $('#qa-admin-status'), more = $('#qa-admin-more');
    let offset = 0;
    function showLogin() { board.hidden = true; login.hidden = false; }
    async function load(reset = true) {
      if (reset) { offset = 0; list.replaceChildren(); }
      feedback.replaceChildren(); more.disabled = true;
      try {
        const items = await rpc('admin_queue', { p_status: status.value, p_offset: offset });
        items.forEach(item => {
          const card = node('article', 'qa-admin-card');
          card.append(node('p', 'qa-muted', item.type === 'question' ? '问题' : '评论 · ' + item.title));
          if (item.type === 'question') card.append(node('h2', '', item.title));
          card.append(meta(item.nickname, item.created_at));
          if (item.parent_body) card.append(node('div', 'qa-quote', '回复：' + item.parent_body.slice(0, 240)));
          card.append(node('div', 'qa-message', item.body));
          const actions = node('div', 'qa-actions'), localFeedback = node('div'); localFeedback.setAttribute('role', 'status');
          async function moderate(next) {
            await busy(card, async () => {
              try { await rpc('admin_moderate', { p_id: item.id, p_type: item.type, p_status: next }); await load(); }
              catch (error) { message(localFeedback, errorText(error), true); }
            });
          }
          if (item.status !== 'published') actions.append(button('审核通过', () => moderate('published'), 'qa-primary'));
          if (item.status !== 'hidden') actions.append(button('隐藏', () => moderate('hidden')));
          if (item.status === 'published') {
            const a = node('a', '', '查看公开页面');
            a.href = item.article_path ? encodeURI(item.article_path) + '#comments' : '/qa/?id=' + item.thread_id;
            a.target = '_blank'; a.rel = 'noopener'; actions.append(a);
          }
          const reply = node('form', 'qa-form'); reply.method = 'post';
          const replyLabel = node('label', '', '以“猎头张振”身份回复');
          const body = node('textarea'); body.required = true; body.maxLength = 6000; body.rows = 6;
          body.id = 'reply-' + item.id; replyLabel.htmlFor = body.id;
          const send = node('button', 'qa-primary', item.status === 'published' ? '发布回复' : '审核通过并回复'); send.type = 'submit';
          reply.append(replyLabel, body, send);
          reply.addEventListener('submit', event => {
            event.preventDefault(); if (!reply.reportValidity()) return;
            busy(card, async () => {
              try {
                await rpc('admin_reply', { p_body: body.value.trim(), p_id: item.id, p_type: item.type });
                body.value = '';
                await load();
              } catch (error) { message(localFeedback, errorText(error), true); }
            });
          });
          card.append(actions, reply, localFeedback); list.append(card);
        });
        offset += items.length; more.hidden = items.length < 50;
        if (!offset) list.append(node('p', 'qa-empty', '这里暂时没有内容。'));
      } catch (error) { message(feedback, errorText(error), true); }
      finally { more.disabled = false; }
    }
    async function verify() {
      const { data } = await client.auth.getSession();
      if (!data.session) { showLogin(); return; }
      if (!(await rpc('admin_status'))) {
        await client.auth.signOut(); showLogin(); message(loginFeedback, '这个账户还没有站长权限，请先完成后台授权。', true); return;
      }
      login.hidden = true; board.hidden = false; await load();
    }
    login.addEventListener('submit', event => {
      event.preventDefault();
      busy(login, async () => {
        try {
          const { error } = await client.auth.signInWithPassword({ email: $('[name=email]', login).value.trim(), password: $('[name=password]', login).value });
          if (error) throw error;
          $('[name=password]', login).value = ''; loginFeedback.replaceChildren(); await verify();
        } catch (error) { message(loginFeedback, errorText(error), true); }
      });
    });
    $('#qa-logout').addEventListener('click', async () => { await client.auth.signOut(); list.replaceChildren(); showLogin(); });
    $('#qa-refresh').addEventListener('click', () => load()); status.addEventListener('change', () => load()); more.addEventListener('click', () => load(false));
    try { await verify(); } catch (error) { showLogin(); message(loginFeedback, errorText(error), true); }
  }
  if (!client) { root.append(node('p', 'qa-feedback', '问答功能暂时未加载，请刷新后重试。')); return; }
  if (mode === 'admin') admin();
  else if (mode === 'article') article();
  else {
    const id = new URLSearchParams(location.search).get('id');
    if (id) {
      $('#qa-home').hidden = true; $('#qa-thread').hidden = false;
      if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) thread(id);
      else message($('#qa-thread-feedback'), '问题地址无效。', true);
    } else questionList();
  }
})();
