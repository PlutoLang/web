// Initialise Editor
var editor = ace.edit("editor");
editor.setTheme("ace/theme/monokai");
editor.session.setUseWorker(false);
editor.session.setMode("ace/mode/lua");
editor.focus();

// Load Code From URL
if (location.hash.substr(0, 6) == "#code=")
{
	editor.setValue(decodeURIComponent(location.hash.substr(6)));
}

// Enviroments
function addOptgroupOptions(elm, name, dname)
{
	Object.keys(environments[name]).reverse().forEach(version => {
		let option = document.createElement("option");
		option.value = name+":"+version;
		option.textContent = dname+" "+version;
		elm.appendChild(option);
	});
}

var rerun_timer;
$.get("https://wasm.pluto.do/manifest.json", function(data)
{
	window.environments = data;
	let latest_pluto_version = Object.keys(environments.pluto).slice(-1)[0];
	window.selected_environment = {
		name: "pluto",
		url: environments.pluto[latest_pluto_version]
	};
	runInEnvironment(window.selected_environment, function()
	{
		// Initial run finished, now register change handlers.

		editor.session.on("change", function(delta)
		{
			clearTimeout(rerun_timer);
			rerun_timer = setTimeout(function()
			{
				runInEnvironment(selected_environment, function(success)
				{
					if (success)
					{
						location.hash = "#code=" + encodeURIComponent(editor.getValue());
					}
				});
			}, 500);
		});

		document.getElementById("version-select").onchange = function()
		{
			let arr = this.value.split(":");
			selected_environment = {
				name: arr[0],
				url: environments[arr[0]][arr[1]]
			};
			runInEnvironment(selected_environment);
		};
	});

	let optgroup = document.createElement("optgroup");
	optgroup.label = "Pluto";
	addOptgroupOptions(optgroup, "pluto", "Pluto");
	document.getElementById("version-select").appendChild(optgroup);

	optgroup = document.createElement("optgroup");
	optgroup.label = "Lua";
	addOptgroupOptions(optgroup, "lua", "Lua");
	document.getElementById("version-select").appendChild(optgroup);
});

// Code Execution
function runInEnvironment(environment, callback)
{
	$("#output").text("$ Loading " + environment.name + ".js...\n");

	var script = document.createElement("script");
	script.id = "environment-js";
	script.src = environment.url;
	script.onload = function()
	{
		$("#environment-js").remove();
		document.getElementById("output").textContent += "$ Loading " + environment.name + ".wasm...\n";

		let config = {};
		config.noInitialRun = true;
		config.preInit = function()
		{
			let todo = 0, buf;
			let out = function(c)
			{
				if (c < 0) // UTF-8 continuation flag?
				{
					c = 256 + c;
					if (todo == 0)
					{
						if ((c & 0b01111000) == 0b01110000) // 11110xxx
						{
							buf = (c & 0b111);
							todo = 3;
						}
						else if ((c & 0b01110000) == 0b01100000) // 1110xxxx
						{
							buf = (c & 0b1111);
							todo = 2;
						}
						else //if ((c & 0b01100000) == 0b01000000) // 110xxxxx
						{
							buf = (c & 0b11111);
							todo = 1;
						}
					}
					else
					{
						buf <<= 6;
						buf |= (c & 0b111111);
						if (--todo == 0)
						{
							document.getElementById("output").textContent += utf32_to_utf16(buf);
						}
					}
				}
				else
				{
					document.getElementById("output").textContent += String.fromCharCode(c);
				}
			};
			config.FS.init(undefined, out, out);
		};
		window[environment.name](config).then(function(mod)
		{
			let prog = {
				mod: mod,
				malloc: mod.cwrap("malloc", "int", ["int"]),
				free: mod.cwrap("free", "void", ["int"]),
				strcpy: mod.cwrap("strcpy", "void", ["int", "string"]),
				main: mod.cwrap("main", "int", ["int", "array"]),
			};

			// Write script to FS
			let data = utf16_to_utf8(editor.getValue());
			let stream = prog.mod.FS.open("script." + environment.name, "w+");
			prog.mod.FS.write(stream, data, 0, data.length, 0);
			prog.mod.FS.close(stream);

			// Execute
			$("#output").text("");
			let argv = [ environment.name, "script." + environment.name ];
			let argv_ptr = allocateStringArray(prog, argv);
			let status = prog.main(argv.length, argv_ptr);
			if (status != 0)
			{
				document.getElementById("output").textContent += "$ Program finished with exit code " + status;
			}

			if (callback)
			{
				callback(status == 0);
			}
		});
	};
	document.body.appendChild(script);
}

function utf32_to_utf16(c)
{
	if (c <= 0xFFFF)
	{
		return String.fromCharCode(c);
	}
	else
	{
		c -= 0x10000;
		return String.fromCharCode((c >> 10) + 0xD800) + String.fromCharCode((c & 0x3FF) + 0xDC00);
	}
}

function utf32_to_utf8(utf8/*: array */, utf32/*: number */)/*: void */
{
	// 1
	if (utf32 < 0b10000000)
	{
		utf8.push(utf32);
		return;
	}
	// 2
	const UTF8_CONTINUATION_FLAG = 0b10000000;
	utf8.push((utf32 & 0b111111) | UTF8_CONTINUATION_FLAG);
	utf32 >>= 6;
	if (utf32 <= 0b11111)
	{
		utf8.splice(utf8.length - 1, 0, utf32 | 0b11000000); // 110xxxxx
		return;
	}
	// 3
	utf8.splice(utf8.length - 1, 0, (utf32 & 0b111111) | UTF8_CONTINUATION_FLAG);
	utf32 >>= 6;
	if (utf32 <= 0b1111)
	{
		utf8.splice(utf8.length - 2, 0, utf32 | 0b11100000); // 1110xxxx
		return;
	}
	// 4
	utf8.splice(utf8.length - 2, 0, (utf32 & 0b111111) | UTF8_CONTINUATION_FLAG);
	utf32 >>= 6;
	utf8.splice(utf8.length - 3, 0, utf32 | 0b11110000); // 11110xxx
}

function utf16_to_utf8(str)
{
	let arr = [];
	for(let i = 0; i != str.length; ++i)
	{
		let c = str.charCodeAt(i);
		if ((c >> 10) == 0x36) // Surrogate pair?
		{
			let hi = c & 0x3ff;
			let lo = str.charCodeAt(++i) & 0x3ff;
			c = (((hi * 0x400) + lo) + 0x10000);
		}
		utf32_to_utf8(arr, c);
	}
	return arr;
}

const PTRSIZE = 4;

function allocateString(prog, str)
{
	let ptr = prog.malloc(str.length + 1);
	prog.strcpy(ptr, str);
	return ptr;
}

function allocateStringArray(prog, arr)
{
	let u32arr = new Uint32Array(arr.length);
	for (let i = 0; i != arr.length; ++i)
	{
		u32arr[i] = allocateString(prog, arr[i]);
	}
	let ptr = prog.malloc(PTRSIZE * arr.length);
	var heap = new Uint8Array(prog.mod.HEAPU8.buffer, ptr, PTRSIZE * arr.length);
	heap.set(new Uint8Array(u32arr.buffer));
	return heap;
}
