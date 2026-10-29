-- Source Sidenote for Neovim: review code against its topic explanation.
-- Talks to the local service over HTTP (curl), like the VS Code extension. Creating topics,
-- stories and settings stay in the web reader; this only reads, reviews and regenerates.
local M = {}

local options = {
  home = nil, -- data directory with connection.json; default $SIDENOTE_HOME or ~/.local/share/source-sidenote
  width = 56,
  annotate = true, -- mark evidence blocks in the sign column of every explained buffer
  hover = true, -- show the block's evidence in a float when the cursor rests in it
}

local ns = vim.api.nvim_create_namespace('sidenote')
local panel = nil -- { win, buf, source (buffer it shows), lines = { [line] = action } }
local state_file = vim.fn.stdpath('data') .. '/sidenote-topics.json'
local float = nil

-- ---- HTTP --------------------------------------------------------------------

local function data_dir()
  return options.home or vim.env.SIDENOTE_HOME or (vim.env.HOME .. '/.local/share/source-sidenote')
end

local function base_url()
  local f = io.open(data_dir() .. '/connection.json', 'r')
  if not f then return nil end
  local ok, conn = pcall(vim.json.decode, f:read('*a'))
  f:close()
  return ok and conn.url or nil
end

--- Calls the service; `done(err, data)` runs on the main loop.
local function request(method, path, body, done)
  local url = base_url()
  if not url then
    return vim.schedule(function() done('Source Sidenote 服务未启动，请先运行 sidenote start') end)
  end
  local cmd = { 'curl', '-sS', '-X', method, '--max-time', '30', '-w', '\n%{http_code}' }
  if body ~= nil then vim.list_extend(cmd, { '-H', 'Content-Type: application/json', '-d', vim.json.encode(body) }) end
  table.insert(cmd, url .. '/api/' .. path)
  vim.system(cmd, { text = true }, function(r)
    vim.schedule(function()
      if r.code ~= 0 then return done('无法连接 Source Sidenote 服务，请先运行 sidenote start') end
      local text, status = r.stdout:match('^(.*)\n(%d+)$')
      -- JSON null becomes nil, so absent values read as absent.
      local ok, data = pcall(vim.json.decode, text or '', { luanil = { object = true, array = true } })
      if not ok then data = {} end
      if tonumber(status) >= 400 then return done(data.error or ('HTTP ' .. status)) end
      done(nil, data)
    end)
  end)
end

local function uri(s)
  return (s:gsub('[^%w%-%._~/]', function(c) return string.format('%%%02X', c:byte()) end))
end

-- ---- remembered topic per project -------------------------------------------

local function read_topics()
  local f = io.open(state_file, 'r')
  if not f then return {} end
  local ok, t = pcall(vim.json.decode, f:read('*a'))
  f:close()
  return ok and type(t) == 'table' and t or {}
end

local function remember_topic(project, topic)
  local t = read_topics()
  t[project] = topic
  local f = io.open(state_file, 'w')
  if f then
    f:write(vim.json.encode(t))
    f:close()
  end
end

-- ---- per-buffer explanation -------------------------------------------------

--- Per buffer: { project, root, path, topic = {id,title,reason}, topics, doc, job, error, untracked }.
--- Kept in Lua (not b: variables) so following the cursor never copies the explanation.
local infos = {}
local function info(buf) return infos[buf] end
local function str(v) return (v == nil or v == vim.NIL) and '' or tostring(v) end

local function evidence_of(i)
  if not i or not i.doc or i.doc.status == 'missing' then return {} end
  return i.doc.explanation.evidence or {}
end

--- The narrowest evidence block containing a 1-based line.
local function narrowest(evidence, line)
  local best
  for idx, ev in ipairs(evidence) do
    if ev.start <= line and line <= ev['end'] then
      if not best or ev['end'] - ev.start < evidence[best]['end'] - evidence[best].start then best = idx end
    end
  end
  return best
end

local render_panel, track

local function annotate(buf)
  if not vim.api.nvim_buf_is_valid(buf) then return end
  vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
  if not options.annotate then return end
  local count = vim.api.nvim_buf_line_count(buf)
  for _, ev in ipairs(evidence_of(info(buf))) do
    for l = ev.start, math.min(ev['end'], count) do
      vim.api.nvim_buf_set_extmark(buf, ns, l - 1, 0, { sign_text = '▏', sign_hl_group = 'SidenoteEvidence', priority = 5 })
    end
  end
end

--- Resolves the buffer's topic and explanation in the background.
local function load(buf, queue)
  if not vim.api.nvim_buf_is_valid(buf) or vim.bo[buf].buftype ~= '' then return end
  local file = vim.api.nvim_buf_get_name(buf)
  if file == '' then return end
  local function set(v)
    if not vim.api.nvim_buf_is_valid(buf) then return end
    infos[buf] = v
    annotate(buf)
    if panel and panel.source == buf then render_panel() end
    if buf == vim.api.nvim_get_current_buf() then track(true) end
  end
  request('GET', 'locate?path=' .. uri(file), nil, function(err, loc)
    if err then return set({ error = err }) end
    if not loc.project or not loc.path then
      return set({ untracked = '这个文件不在已注册的项目中。在项目根目录执行 sidenote add 后即可对照阅读。' })
    end
    local base = { project = loc.project.id, root = loc.project.root, path = loc.path, topics = loc.topics }
    if not loc.inScope then
      return set(vim.tbl_extend('force', base, { untracked = '这个文件不在项目的扫描范围内（被忽略或不是源码）。' }))
    end
    if #loc.topics == 0 then
      return set(vim.tbl_extend('force', base, {
        untracked = '还没有主题覆盖这个文件。用 :SidenoteWeb 在网页里新建主题，AI 会挑出相关文件并生成说明。',
      }))
    end
    -- The topic picked for this project, else the newest topic covering the file.
    local stored = read_topics()[loc.project.id]
    local topic = loc.topics[#loc.topics]
    for _, t in ipairs(loc.topics) do if t.id == stored then topic = t end end
    base.topic = topic
    local function fetch(blocked)
      request('GET', 'topics/' .. topic.id .. '/document?path=' .. uri(loc.path), nil, function(e2, doc)
        if e2 then return set(vim.tbl_extend('force', base, { error = e2 })) end
        request('GET', 'jobs', nil, function(_, jobs)
          local job
          for _, j in ipairs(jobs or {}) do
            if j.topic == topic.id and j.path == loc.path and (j.kind == 'generate' or j.kind == 'review') then
              job = j
              break
            end
          end
          set(vim.tbl_extend('force', base, { doc = doc, job = job, blocked = blocked }))
        end)
      end)
    end
    if not queue then return fetch(nil) end
    request('POST', 'topics/' .. topic.id .. '/run', { path = loc.path, kind = queue }, function(e3, r)
      fetch(e3 or (r and r.blocked) or nil)
    end)
  end)
end

-- ---- cursor ↔ evidence -------------------------------------------------------

local block_ns = vim.api.nvim_create_namespace('sidenote-block')
local active = { buf = nil, index = nil }

local function close_float()
  if float and vim.api.nvim_win_is_valid(float) then vim.api.nvim_win_close(float, true) end
  float = nil
end

--- Follows the cursor: the block it is in lights up in the code and in the panel.
track = function(force)
  local buf = vim.api.nvim_get_current_buf()
  if panel and buf == panel.buf then return end
  local i = info(buf)
  local evidence = evidence_of(i)
  local index = narrowest(evidence, vim.api.nvim_win_get_cursor(0)[1])
  if not force and active.buf == buf and active.index == index then return end
  if active.buf and vim.api.nvim_buf_is_valid(active.buf) then
    vim.api.nvim_buf_clear_namespace(active.buf, block_ns, 0, -1)
  end
  active = { buf = buf, index = index }
  close_float()
  local ev = index and evidence[index]
  if ev then
    local count = vim.api.nvim_buf_line_count(buf)
    vim.api.nvim_buf_set_extmark(buf, block_ns, ev.start - 1, 0, {
      end_row = math.min(ev['end'], count),
      hl_group = 'SidenoteBlock',
      hl_eol = true,
      priority = 10,
    })
  end
  if panel and panel.source == buf then render_panel() end
end

local function show_float()
  if not options.hover or float then return end
  local buf = vim.api.nvim_get_current_buf()
  local i = info(buf)
  local ev = active.buf == buf and active.index and evidence_of(i)[active.index]
  if not ev then return end
  local range = ev.start == ev['end'] and ('L' .. ev.start) or ('L' .. ev.start .. '–' .. ev['end'])
  local lines = { range .. ' · ' .. i.topic.title, '' }
  vim.list_extend(lines, vim.split(ev.explanation, '\n', { plain = true }))
  local fbuf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(fbuf, 0, -1, false, lines)
  vim.bo[fbuf].filetype = 'markdown'
  local width = math.min(72, math.max(24, vim.o.columns - 10))
  float = vim.api.nvim_open_win(fbuf, false, {
    relative = 'cursor', row = 1, col = 0, width = width,
    height = math.min(#lines + 2, 12), style = 'minimal', border = 'rounded', focusable = false,
  })
  vim.wo[float].wrap = true
end

-- ---- panel -------------------------------------------------------------------

local function job_note(job)
  if not job then return nil end
  if job.state == 'queued' or job.state == 'running' then
    return job.kind == 'review' and '> 正在复查，完成后自动刷新…'
      or (job.state == 'running' and '> 正在生成说明，完成后自动刷新…' or '> 已加入队列，完成后自动刷新…')
  end
  if job.state == 'failed' then
    return '> ' .. (job.kind == 'review' and '上次复查失败：' or '上次生成失败：') .. str(job.error)
  end
end

render_panel = function()
  if not panel or not vim.api.nvim_win_is_valid(panel.win) then return end
  local i = info(panel.source)
  local out, actions, mark = {}, {}, nil
  local function add(line, action)
    for _, l in ipairs(vim.split(line, '\n', { plain = true })) do
      table.insert(out, l)
      if action then actions[#out] = action end
    end
  end
  local name = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(panel.source), ':t')
  if not i then
    add('# ' .. name)
    add('')
    add('正在读取说明…')
  elseif i.error then
    add('# 暂时无法获取说明')
    add('')
    add(i.error)
  elseif i.untracked then
    add('# ' .. name)
    add('')
    add(i.untracked)
  else
    local doc = i.doc
    local status = doc.status == 'fresh' and '最新' or doc.status == 'stale' and '已过期' or '还没有说明'
    add('# ' .. i.path)
    add('')
    add('主题：**' .. i.topic.title .. '** · ' .. status .. (#i.topics > 1 and ('（' .. #i.topics .. ' 个主题，gt 切换）') or ''))
    if str(i.topic.reason) ~= '' then add('_' .. i.topic.reason .. '_') end
    add('')
    local note = job_note(i.job)
    if note then add(note) add('') end
    if i.blocked then add('> ' .. i.blocked) add('') end
    if vim.bo[panel.source].modified then add('> 文件有未保存的修改；说明针对磁盘上已保存的版本。') add('') end
    if doc.status == 'missing' then
      add('这个文件在主题里还没有说明。按 gr 生成（会把该文件和有限上下文发给这个主题所选的模型）。')
    else
      local e = doc.explanation
      if doc.status == 'stale' then add('> 源码、直接依赖或模型已变化，说明可能不准确。按 gr 重新生成。') add('') end
      add(e.summary)
      if str(e.why) ~= '' then add('') add(e.why) end
      add('')
      add('_' .. str(doc.model) .. '_')
      if e.scenario and #e.scenario > 0 then
        add('')
        add('## 走一遍')
        for n, s in ipairs(e.scenario) do add(n .. '. ' .. s) end
      end
      if #e.flow > 0 then
        add('')
        add('## 核心流程')
        for n, s in ipairs(e.flow) do add(n .. '. ' .. s) end
      end
      if #e.responsibilities > 0 then
        add('')
        add('## 职责')
        for _, s in ipairs(e.responsibilities) do add('- ' .. s) end
      end
      if e.terms and #e.terms > 0 then
        add('')
        add('## 术语')
        for _, t in ipairs(e.terms) do add('- **' .. str(t.term) .. '**：' .. str(t.meaning)) end
      end
      if #e.evidence > 0 then
        add('')
        add('## 代码依据（<CR> 定位）')
        for n, ev in ipairs(e.evidence) do
          local range = ev.start == ev['end'] and ('L' .. ev.start) or ('L' .. ev.start .. '–' .. ev['end'])
          local first = #out + 1
          add('- `' .. range .. '` ' .. ev.explanation, { reveal = ev })
          if active.buf == panel.source and active.index == n then mark = { first, #out } end
        end
      end
      if #e.relations > 0 then
        add('')
        add('## 关联文件（<CR> 打开）')
        for _, r in ipairs(e.relations) do add('- `' .. r.path .. '` ' .. r.description, { open = r.path }) end
      end
      if #e.caveats > 0 then
        add('')
        add('## 阅读注意')
        for _, s in ipairs(e.caveats) do add('- ' .. s) end
      end
      if doc.review then
        add('')
        add('## AI 复查：' .. (doc.review.verdict == 'pass' and '通过' or '需要修改'))
        for _, s in ipairs(doc.review.issues or {}) do add('- ' .. str(s)) end
      end
    end
  end
  add('')
  add('_gr 重新生成 · gR AI 复查 · gt 切换主题 · go 阅读顺序 · gw 网页阅读 · q 关闭_')
  panel.lines = actions
  local buf = panel.buf
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, out)
  vim.bo[buf].modifiable = false
  vim.api.nvim_buf_clear_namespace(buf, block_ns, 0, -1)
  if mark then
    vim.api.nvim_buf_set_extmark(buf, block_ns, mark[1] - 1, 0, { end_row = mark[2], hl_group = 'SidenoteBlock', hl_eol = true })
    -- Keep the entry for the cursor's block in view, unless the reader is in the panel.
    if vim.api.nvim_get_current_win() ~= panel.win then
      pcall(vim.api.nvim_win_set_cursor, panel.win, { mark[1], 0 })
    end
  end
end

local function source_win()
  if not panel then return nil end
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    if w ~= panel.win and vim.api.nvim_win_get_buf(w) == panel.source then return w end
  end
end

local function panel_action()
  local a = panel and panel.lines[vim.api.nvim_win_get_cursor(0)[1]]
  if not a then return end
  local i = info(panel.source)
  local w = source_win()
  if a.reveal and w then
    vim.api.nvim_set_current_win(w)
    vim.api.nvim_win_set_cursor(w, { a.reveal.start, 0 })
    vim.cmd('normal! zz')
    track(true)
  elseif a.open and i and i.root then
    if w then vim.api.nvim_set_current_win(w) end
    vim.cmd('edit ' .. vim.fn.fnameescape(i.root .. '/' .. a.open))
  end
end

function M.open()
  local buf = vim.api.nvim_get_current_buf()
  if panel and buf == panel.buf then return end
  if vim.bo[buf].buftype ~= '' or vim.api.nvim_buf_get_name(buf) == '' then
    return vim.notify('请在源码文件中执行 :Sidenote', vim.log.levels.WARN)
  end
  local win = vim.api.nvim_get_current_win()
  if not panel or not vim.api.nvim_win_is_valid(panel.win) then
    vim.cmd('rightbelow vsplit')
    local pbuf = vim.api.nvim_create_buf(false, true)
    panel = { win = vim.api.nvim_get_current_win(), buf = pbuf, lines = {} }
    vim.api.nvim_win_set_buf(panel.win, pbuf)
    vim.api.nvim_win_set_width(panel.win, options.width)
    vim.bo[pbuf].buftype = 'nofile'
    vim.bo[pbuf].bufhidden = 'wipe'
    vim.bo[pbuf].swapfile = false
    vim.bo[pbuf].filetype = 'markdown'
    vim.wo[panel.win].wrap = true
    vim.wo[panel.win].linebreak = true
    vim.wo[panel.win].number = false
    vim.wo[panel.win].relativenumber = false
    vim.wo[panel.win].signcolumn = 'no'
    vim.wo[panel.win].winfixwidth = true
    local map = function(lhs, fn) vim.keymap.set('n', lhs, fn, { buffer = pbuf, nowait = true }) end
    map('q', M.close)
    map('<CR>', panel_action)
    map('gr', function() M.run('generate') end)
    map('gR', function() M.run('review') end)
    map('gt', M.choose_topic)
    map('go', M.order)
    map('gw', M.web)
  end
  panel.source = buf
  vim.api.nvim_set_current_win(win)
  if not info(buf) then load(buf) end
  render_panel()
end

function M.close()
  if panel and vim.api.nvim_win_is_valid(panel.win) then vim.api.nvim_win_close(panel.win, true) end
  panel = nil
end

local function current_info()
  local buf = panel and vim.api.nvim_get_current_buf() == panel.buf and panel.source or vim.api.nvim_get_current_buf()
  return buf, info(buf)
end

function M.run(kind)
  local buf, i = current_info()
  if not i or not i.topic then return vim.notify('这个文件不在任何主题里', vim.log.levels.WARN) end
  load(buf, kind)
end

function M.choose_topic()
  local buf, i = current_info()
  if not i or not i.project then return vim.notify('当前文件不在已注册的项目中', vim.log.levels.WARN) end
  request('GET', 'projects/' .. i.project .. '/topics', nil, function(err, topics)
    if err then return vim.notify(err, vim.log.levels.ERROR) end
    local confirmed = vim.tbl_filter(function(t) return t.state == 'confirmed' end, topics)
    if #confirmed == 0 then return vim.notify('这个项目还没有已确认的主题；用 :SidenoteWeb 在网页里新建', vim.log.levels.WARN) end
    vim.ui.select(confirmed, {
      prompt = '选择要对照阅读的主题',
      format_item = function(t) return t.title .. '（' .. t.fresh .. '/' .. t.files .. ' 份说明最新）' end,
    }, function(choice)
      if not choice then return end
      remember_topic(i.project, choice.id)
      for _, b in ipairs(vim.api.nvim_list_bufs()) do
        local bi = info(b)
        if bi and bi.project == i.project then load(b) end
      end
      if not info(buf) then load(buf) end
    end)
  end)
end

--- The topic's files in reading order, as a quickfix list (:cnext walks them).
function M.order()
  local _, i = current_info()
  if not i or not i.topic then return vim.notify('这个文件不在任何主题里', vim.log.levels.WARN) end
  request('GET', 'topics/' .. i.topic.id, nil, function(err, topic)
    if err then return vim.notify(err, vim.log.levels.ERROR) end
    local items = {}
    for n, e in ipairs(topic.entries) do
      local status = e.status == 'fresh' and '' or e.status == 'stale' and '［已过期］' or '［无说明］'
      table.insert(items, {
        filename = i.root .. '/' .. e.path, lnum = 1,
        text = n .. '. ' .. (str(e.brief) ~= '' and e.brief or str(e.reason)) .. status,
      })
    end
    vim.fn.setqflist({}, ' ', { title = 'Sidenote · ' .. topic.title, items = items })
    vim.cmd('copen')
  end)
end

--- Opens the web reader at the same topic, file and block (or the project to create a topic).
function M.web()
  local _, i = current_info()
  local url = base_url()
  if not url then return vim.notify('Source Sidenote 服务未启动，请先运行 sidenote start', vim.log.levels.WARN) end
  if i and i.project then
    url = url .. '/projects/' .. i.project
    if i.topic then
      url = url .. '?topic=' .. i.topic.id .. '&file=' .. uri(i.path)
      local ev = active.index and evidence_of(i)[active.index]
      if ev then url = url .. '&lines=' .. ev.start .. '-' .. ev['end'] end
    end
  end
  vim.ui.open(url)
end

-- ---- live updates ------------------------------------------------------------

local reload_timer = vim.uv.new_timer()
local function reload_all()
  reload_timer:stop()
  reload_timer:start(400, 0, vim.schedule_wrap(function()
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_is_loaded(b) and info(b) then load(b) end
    end
  end))
end

--- Follows /api/events with a long-lived curl; reconnects with backoff.
local function listen(delay)
  local url = base_url()
  if not url then
    return vim.defer_fn(function() listen(math.min((delay or 1000) * 2, 15000)) end, delay or 1000)
  end
  local buffer = ''
  vim.system({ 'curl', '-sN', url .. '/api/events' }, {
    stdout = function(_, chunk)
      if not chunk then return end
      buffer = buffer .. chunk
      for event in buffer:gmatch('(.-)\n\n') do
        local data = event:match('data: (.*)')
        local ok, msg = pcall(vim.json.decode, data or '')
        if ok and msg.topic and msg.topic ~= 'config' then reload_all() end
      end
      buffer = buffer:match('.*\n\n(.*)$') or buffer
    end,
  }, function()
    vim.defer_fn(function() listen(math.min((delay or 1000) * 2, 15000)) end, delay or 1000)
  end)
end

-- ---- setup -------------------------------------------------------------------

function M.setup(opts)
  options = vim.tbl_deep_extend('force', options, opts or {})
  -- Same warm block colour as the web reader and VS Code; users can override the groups.
  local dark = vim.o.background == 'dark'
  vim.api.nvim_set_hl(0, 'SidenoteBlock', { default = true, bg = dark and '#3a3420' or '#fdf3cf' })
  vim.api.nvim_set_hl(0, 'SidenoteEvidence', { default = true, link = 'LineNr' })

  local group = vim.api.nvim_create_augroup('sidenote', { clear = true })
  vim.api.nvim_create_autocmd('BufEnter', {
    group = group,
    callback = function(ev)
      if panel and ev.buf == panel.buf then return end
      if vim.bo[ev.buf].buftype ~= '' then return end
      if panel and vim.api.nvim_win_is_valid(panel.win) then
        panel.source = ev.buf
        render_panel()
      end
      if not info(ev.buf) and (options.annotate or panel) then load(ev.buf) else track(true) end
    end,
  })
  vim.api.nvim_create_autocmd('BufWritePost', { group = group, callback = function(ev) load(ev.buf) end })
  vim.api.nvim_create_autocmd('BufWipeout', { group = group, callback = function(ev) infos[ev.buf] = nil end })
  vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI' }, { group = group, callback = function() track(false) end })
  vim.api.nvim_create_autocmd('CursorHold', { group = group, callback = show_float })
  vim.api.nvim_create_autocmd('WinClosed', {
    group = group,
    callback = function(ev) if panel and tonumber(ev.match) == panel.win then panel = nil end end,
  })

  vim.api.nvim_create_user_command('Sidenote', M.open, { desc = '在右侧打开当前文件的主题说明' })
  vim.api.nvim_create_user_command('SidenoteClose', M.close, {})
  vim.api.nvim_create_user_command('SidenoteTopic', M.choose_topic, { desc = '选择这个项目要对照阅读的主题' })
  vim.api.nvim_create_user_command('SidenoteReview', function() M.run('review') end, { desc = 'AI 复查当前文件的说明' })
  vim.api.nvim_create_user_command('SidenoteRegenerate', function() M.run('generate') end, {})
  vim.api.nvim_create_user_command('SidenoteOrder', M.order, { desc = '把主题文件按阅读顺序放进 quickfix' })
  vim.api.nvim_create_user_command('SidenoteWeb', M.web, { desc = '在网页阅读器中打开同一位置' })
  listen()
end

-- For tests and statuslines.
M._info = info
M._active = function() return active end
M._panel = function() return panel end

return M
