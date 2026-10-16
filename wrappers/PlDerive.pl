#!/usr/bin/env perl
use strict; use warnings;
use lib "../gitpp-pl/lib";
use Gitpp;
use JSON::PP;
local $/;
my $d = Gitpp::derive(decode_json(<STDIN>));
my $out = {
    state => $d->{state},
    order => $d->{order},
    conflicts => [ map { { key => $_->{key}, winner => $_->{winner}, losers => [ sort { Gitpp::code_point_cmp($a,$b) } @{$_->{losers}} ] } } @{$d->{conflicts}} ],
    orphans => [ sort { Gitpp::code_point_cmp($a,$b) } @{$d->{orphans}} ],
};
print JSON::PP->new->canonical(1)->utf8(1)->encode($out), "\n";
