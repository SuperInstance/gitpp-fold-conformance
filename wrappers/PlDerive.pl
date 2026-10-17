#!/usr/bin/env perl
# Perl port wrapper.
#
# The module path is resolved at RUN time from GITPP_PL_DIR, defaulting to
# the sibling checkout the workflow creates. It was hardcoded to a scratch
# directory on one machine, so in CI `use Gitpp` failed and the port simply
# did not participate -- and a run over four ports reports the same pass
# count as a run over five, so nothing in the output distinguished them.
use strict;
use warnings;

# `use lib` runs at COMPILE time, so the list must be built from the
# environment inline -- a preceding `my @candidates` is not yet assigned
# when the use statement is compiled, which is why an earlier version
# silently searched the wrong directories.
use lib (($ENV{GITPP_PL_DIR} // "") ? "$ENV{GITPP_PL_DIR}/lib" : ());
use lib "../gitpp-pl/lib";
use lib "/tmp/gitpp-pl/lib";   # legacy single-machine layout

use Gitpp;
use JSON::PP;
local $/;
my $d = Gitpp::derive(decode_json(<STDIN>));
my $out = {
    state => $d->{state},
    setters => $d->{setters},
    order => $d->{order},
    conflicts => [ map { { key => $_->{key}, winner => $_->{winner},
                           losers => [ sort { Gitpp::code_point_cmp($a,$b) } @{$_->{losers}} ] } }
                    @{$d->{conflicts}} ],
    orphans => [ sort { Gitpp::code_point_cmp($a,$b) } @{$d->{orphans}} ],
};
print JSON::PP->new->canonical(1)->utf8(1)->encode($out), "\n";
