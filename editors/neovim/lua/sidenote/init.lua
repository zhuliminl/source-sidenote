local M = {}
local options = { command = { 'sidenote' }, width = 52 }
local panels = {}
local generation = 0
local function show(source_win, path, result)
  if not vim.api.nvim_win_is_valid(source_win) then return end
  local panel = panels[source_win]
  if not panel or not vim.api.nvim_win_is_valid(panel.win) then
    vim.api.nvim_set_current_win(source_win)
    vim.cmd('rightbelow vsplit')
    panel = { win = vim.api.nvim_get_current_win(), buf = vim.api.nvim_create_buf(false, true) }
    vim.api.nvim_win_set_buf(panel.win, panel.buf)
    vim.api.nvim_win_set_width(panel.win, options.width)
    panels[source_win] = panel
    vim.bo[panel.buf].buftype = 'nofile'
    vim.bo[panel.buf].bufhidden = 'wipe'
    vim.bo[panel.buf].swapfile = false
    vim.bo[panel.buf].filetype = 'markdown'
    vim.wo[panel.win].wrap = true
    vim.wo[panel.win].number = false
    vim.wo[panel.win].relativenumber = false
    vim.keymap.set('n', 'q', function() if vim.api.nvim_win_is_valid(panel.win) then vim.api.nvim_win_close(panel.win, true) end end, {buffer=panel.buf})
  end
  local text = result.markdown or ''
  if result.status == 'missing' then
    text = result.topic and '# 说明尚未生成\n\n这个主题的生成任务可能仍在进行，可在管理页查看。'
      or '# 还没有主题覆盖这个文件\n\n在管理页创建一个主题，AI 会挑选相关文件并生成说明。'
    if result.url then text = text .. '\n\n' .. result.url end
  end
  if result.status == 'stale' then text = '> 源码、依赖或模型已变化，说明可能过期；可在管理页重新生成。\n\n' .. text end
  if result.topic then
    local others = #(result.topics or {}) > 1 and ('（共 ' .. #result.topics .. ' 个主题，:SidenoteTopic 切换）') or ''
    text = '> 主题：' .. result.topic.title .. others .. '\n\n' .. text
  end
  vim.bo[panel.buf].modifiable = true
  vim.api.nvim_buf_set_lines(panel.buf, 0, -1, false, vim.split(text, '\n', {plain=true}))
  vim.bo[panel.buf].modifiable = false
  vim.api.nvim_set_current_win(source_win)
end
local last = {}
function M.open(topic)
  local win = vim.api.nvim_get_current_win()
  local path = vim.api.nvim_buf_get_name(0)
  if vim.bo.buftype ~= '' or path == '' then return vim.notify('请在源码文件中执行 Sidenote', vim.log.levels.WARN) end
  if vim.bo.modified then return vim.notify('请先保存文件；当前版本解释磁盘内容', vim.log.levels.WARN) end
  generation = generation + 1
  local ticket = generation
  local cmd = vim.deepcopy(options.command)
  show(win, path, {markdown='# 正在读取说明'})
  vim.list_extend(cmd, {'explain', path})
  if topic then vim.list_extend(cmd, {'--topic', topic}) end
  vim.system(cmd, {text=true}, function(result)
    vim.schedule(function()
      if ticket ~= generation or not vim.api.nvim_win_is_valid(win) then return end
      if vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(win)) ~= path then return end
      if result.code ~= 0 then
        show(win, path, {markdown='# 暂时无法获取说明\n\n' .. result.stderr})
        return vim.notify(result.stderr, vim.log.levels.ERROR)
      end
      local ok, data = pcall(vim.json.decode, result.stdout)
      if not ok then return vim.notify('无法解析 Sidenote 响应', vim.log.levels.ERROR) end
      last[path] = data.topics
      show(win, path, data)
    end)
  end)
end
function M.setup(opts)
  options = vim.tbl_deep_extend('force', options, opts or {})
  vim.api.nvim_create_user_command('Sidenote', function() M.open(nil) end, {})
  vim.api.nvim_create_user_command('SidenoteTopic', function()
    local topics = last[vim.api.nvim_buf_get_name(0)]
    if not topics or #topics == 0 then return vim.notify('请先执行 :Sidenote；该文件还没有主题', vim.log.levels.WARN) end
    vim.ui.select(topics, {prompt='选择主题', format_item=function(t) return t.title end}, function(choice)
      if choice then M.open(choice.id) end
    end)
  end, {})
  vim.api.nvim_create_user_command('SidenoteClose', function()
    for _,panel in pairs(panels) do if vim.api.nvim_win_is_valid(panel.win) then vim.api.nvim_win_close(panel.win,true) end end
    panels = {}
  end, {})
end
return M
