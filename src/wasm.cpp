#include "lauxlib.h"
#include "lualib.h"

#include "emscripten.h"

extern "C" EMSCRIPTEN_KEEPALIVE const char* run_pluto_code(const char* code)
{
	out_buf.clear();

	auto L = luaL_newstate();
	luaL_openlibs(L);

	lua_pushstring(L, code);
	lua_setglobal(L, "PLUTO_WASM_CODE");

	luaL_dostring(L, R"(--[[Pluto Web Runtime]]
xpcall(function()
	local f, err = load(PLUTO_WASM_CODE)
	if f then 
		f()
	else
		print(err)
	end
end, function(e)
	print(debug.traceback(e,2))
end))");

	lua_close(L);

	return out_buf.c_str();
}
