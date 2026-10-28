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
  if result.status == 'missing' then text = '# 正在生成说明\n\n稍后再次执行 :Sidenote，或在管理页查看任务状态。' end
  if result.status == 'stale' then text = '> 说明已过期，使用 :SidenoteRefresh 更新。\n\n' .. text end
  vim.bo[panel.buf].modifiable = true
  vim.api.nvim_buf_set_lines(panel.buf, 0, -1, false, vim.split(text, '\n', {plain=true}))
  vim.bo[panel.buf].modifiable = false
  vim.api.nvim_set_current_win(source_win)
end
function M.open(refresh)
  local win = vim.api.nvim_get_current_win()
  local path = vim.api.nvim_buf_get_name(0)
  if vim.bo.buftype ~= '' or path == '' then return vim.notify('请在源码文件中执行 Sidenote', vim.log.levels.WARN) end
  if vim.bo.modified then return vim.notify('请先保存文件；当前版本解释磁盘内容', vim.log.levels.WARN) end
  generation = generation + 1
  local ticket = generation
  local cmd = vim.deepcopy(options.command)
  show(win, path, {markdown='# 正在读取说明\n\n首次生成可能需要等待模型响应。'})
  vim.list_extend(cmd, {'explain', path, '--wait'})
  if refresh then table.insert(cmd, '--refresh') end
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
      show(win, path, data)
    end)
  end)
end
function M.setup(opts)
  options = vim.tbl_deep_extend('force', options, opts or {})
  vim.api.nvim_create_user_command('Sidenote', function() M.open(false) end, {})
  vim.api.nvim_create_user_command('SidenoteRefresh', function() M.open(true) end, {})
  vim.api.nvim_create_user_command('SidenoteClose', function()
    for _,panel in pairs(panels) do if vim.api.nvim_win_is_valid(panel.win) then vim.api.nvim_win_close(panel.win,true) end end
    panels = {}
  end, {})
end
return M
