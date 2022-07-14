<?php
require __DIR__."/common.php";
check_compiler();

$cmd = $compiler." -o src/pluto.exe";

for_each_obj(function($file)
{
	if($file != "luac")
	{
		global $cmd;
		$cmd .= " int/{$file}.o";
	}
});

passthru($cmd);
