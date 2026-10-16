using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Gitpp;

class Program {
  static async Task Main() {
    var json = await Console.In.ReadToEndAsync();
    var records = Gitpp.Numbers.ParseRecords(json);
    var r = Fold.Derive(records);
    var conflicts = r.Conflicts.Select(c => new {
      key = c.GetValueOrDefault("key")?.ToString() ?? "",
      winner = c.GetValueOrDefault("winner")?.ToString() ?? "",
      losers = (c.GetValueOrDefault("losers") is System.Collections.IEnumerable e && c.GetValueOrDefault("losers") is not string)
        ? e.Cast<object>().Select(x => x?.ToString() ?? "").OrderBy(x => x, StringComparer.Ordinal).ToArray()
        : Array.Empty<string>()
    }).ToArray();
    var payload = new {
      state = r.State,
      setters = r.Setters,
      order = r.Order.ToArray(),
      conflicts,
      orphans = r.Orphans.OrderBy(x => x, StringComparer.Ordinal).ToArray()
    };
    Console.WriteLine(JsonSerializer.Serialize(payload));
  }
}
