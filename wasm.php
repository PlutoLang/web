<?php
$clang = "em++ -O3 -flto -std=c++20 -fvisibility=hidden"; // remove "-fvisibility=hidden" for debugging

// Setup folders
if(!is_dir("bin"))
{
	mkdir("bin");
}
if(!is_dir("bin/int"))
{
	mkdir("bin/int");
}

// Find work
$files = [];
foreach(scandir("src") as $file)
{
	if(substr($file, -4) == ".cpp")
	{
		$name = substr($file, 0, -4);
		if($name != "lua" && $name != "luac")
		{
			array_push($files, $name);
		}
	}
}

echo "Compiling...\n";
$objects = [];
foreach($files as $file)
{
	echo $file."\n";
	passthru("$clang -c src/$file.cpp -o bin/int/$file.o");
	array_push($objects, escapeshellarg("bin/int/$file.o"));
}

echo "Linking...\n";
$clang .= " -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME=libpluto -s EXPORTED_RUNTIME_METHODS=[\"cwrap\"]";
//$clang .= " -s LINKABLE=1 -s EXPORT_ALL=1"; // uncomment for debugging
passthru("$clang -o libpluto.js ".join(" ", $objects));
