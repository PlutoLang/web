// Initialise Editor
var editor = ace.edit("editor");
editor.setTheme("ace/theme/monokai");
editor.session.setUseWorker(false);
editor.session.setMode("ace/mode/lua");
editor.focus();

// Files
var file_contents = {
	'index.pluto': `if _PVERSION then
	-- Pluto
	print("Hello from ".._PVERSION)
else
	-- Lua
	print("Hello from ".._VERSION)
end`
};

function addFile(name, contents)
{
	file_contents[name] = contents;

	let li = document.createElement("li");
	let a = document.createElement("a");
	a.textContent = name;
	li.appendChild(a);
	let reference = document.getElementById("add-file");
	reference.parentNode.insertBefore(li, reference);
}

function activateFile(name)
{
	document.querySelectorAll(".uk-tab > li").forEach(li => {
		if (li.querySelector("a").textContent == name)
		{
			li.classList.add("uk-active");
		}
		else
		{
			li.classList.remove("uk-active");
		}
	});

	editor.setValue(file_contents[name]);
}

function getActiveFile()
{
	return document.querySelector(".uk-tab .uk-active a").textContent;
}

document.addEventListener("click", function(e)
{
	let file_clicked;
	if (e.target.matches(".uk-tab > li"))
	{
		file_clicked = e.target.querySelector("a").textContent;
	}
	else if (e.target.closest(".uk-tab > li"))
	{
		file_clicked = e.target.closest(".uk-tab > li").querySelector("a").textContent;
	}
	if (file_clicked)
	{
		if (file_clicked == "+")
		{
			let name = window.prompt("File name");
			if (name)
			{
				addFile(name, "");
				activateFile(name);
			}
		}
		else
		{
			activateFile(file_clicked);
		}
	}
});

// Shareable state
function updateShare()
{
	if (Object.keys(file_contents).length > 1)
	{
		let parts = [];
		for (const [name, contents] of Object.entries(file_contents))
		{
			parts.push("file_names[]=" + encodeURIComponent(name));
			parts.push("file_contents[]=" + encodeURIComponent(contents));
		}
		location.hash = "#" + parts.join("&");
	}
	else
	{
		location.hash = "#code=" + encodeURIComponent(editor.getValue());
	}
}

let params = new URLSearchParams(location.hash.replace("#", "?"));
if (params.has("code"))
{
	file_contents["index.pluto"] = params.get("code");
}
else if (params.has("file_names[]") && params.has("file_contents[]"))
{
	let shared_file_names = params.getAll("file_names[]");
	let shared_file_contents = params.getAll("file_contents[]");
	if (shared_file_names.length == shared_file_contents.length)
	{
		for (let i = 0; i != shared_file_names.length; ++i)
		{
			if (shared_file_names[i] == "index.pluto")
			{
				file_contents["index.pluto"] = shared_file_contents[i];
			}
			else
			{
				addFile(shared_file_names[i], shared_file_contents[i]);
			}
		}
	}
}
activateFile("index.pluto");

// Enviroments
var latest_pluto_version;
function addOptgroupOptions(elm, name, dname)
{
	Object.keys(environments[name]).reverse().forEach(version => {
		let option = document.createElement("option");
		option.value = name+":"+version;
		option.textContent = dname+" "+version;
		if (name == "pluto" && version == latest_pluto_version)
		{
			option.selected = true;
		}
		elm.appendChild(option);
	});
}

var rerun_timer;
$.get("https://wasm.pluto.do/manifest.json", function(data)
{
	window.environments = data;

	Object.keys(environments.pluto).reverse().forEach(version => {
		if (!latest_pluto_version
			&& version.indexOf('-') == -1
			)
		{
			latest_pluto_version = version;
		}
	});

	window.selected_environment = {
		name: "pluto",
		url: environments.pluto[latest_pluto_version]
	};
	runInEnvironment(window.selected_environment, function()
	{
		// Initial run finished, now register change handlers.

		editor.session.on("change", function(delta)
		{
			file_contents[getActiveFile()] = editor.getValue();

			clearTimeout(rerun_timer);
			rerun_timer = setTimeout(function()
			{
				runInEnvironment(selected_environment, function(success)
				{
					updateShare();
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

			// Write files to FS
			for (const [name, contents] of Object.entries(file_contents))
			{
				let data = utf16_to_utf8(contents);
				let stream = prog.mod.FS.open(name, "w+");
				prog.mod.FS.write(stream, data, 0, data.length, 0);
				prog.mod.FS.close(stream);
			}

			// Execute
			$("#output").text("");
			let argv = [ environment.name, "index.pluto" ];
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
