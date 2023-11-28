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
			let buf = -1;
			let out = function(c)
			{
				if (c < 0) // UTF-8 continuation flag?
				{
					c = 256 + c;
					if (buf != -1)
					{
						// NOTE: Assuming only 2-byte combinations (110xxxxx 11xxxxxx)
						let utf16 = (buf & 0b11111);
						utf16 <<= 6;
						utf16 |= (c & 0b111111);
						document.getElementById("output").textContent += String.fromCharCode(utf16);
						buf = -1;
					}
					else
					{
						buf = c;
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

function utf16_to_utf8(str)
{
	// NOTE: Currently doesn't handle UTF-16 surrogate pairs.
	let arr = [];
	for(let i = 0; i != str.length; ++i)
	{
		let c = str.charCodeAt(i);
		if (c < 0b10000000)
		{
			arr.push(c);
		}
		else
		{
			let hi = (c & 0b111111) | 0b10000000;
			c >>= 6;
			arr.push(c | 0b11000000);
			arr.push(hi);
		}
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
